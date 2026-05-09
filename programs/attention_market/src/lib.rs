use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod attention_market {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        content_id: String,
        title: String,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(content_id.len() <= 64, MarketError::ContentIdTooLong);
        require!(title.len() <= 128, MarketError::TitleTooLong);
        require!(duration_seconds > 0, MarketError::InvalidDuration);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        market.content_id = content_id;
        market.title = title;
        market.authority = ctx.accounts.authority.key();
        market.total_viral = 0;
        market.total_flop = 0;
        market.end_time = clock.unix_timestamp + duration_seconds;
        market.resolved = false;
        market.outcome = 0;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        outcome: u8,
        amount_lamports: u64,
    ) -> Result<()> {
        require!(outcome == 1 || outcome == 2, MarketError::InvalidOutcome);
        require!(amount_lamports > 0, MarketError::InvalidAmount);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, MarketError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp < market.end_time,
            MarketError::MarketExpired
        );

        // Transfer SOL from user to vault
        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.user.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
        );
        system_program::transfer(cpi_ctx, amount_lamports)?;

        // Update market totals
        if outcome == 1 {
            market.total_viral = market
                .total_viral
                .checked_add(amount_lamports)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.total_flop = market
                .total_flop
                .checked_add(amount_lamports)
                .ok_or(MarketError::Overflow)?;
        }

        // Initialize bet record
        let bet = &mut ctx.accounts.bet;
        bet.market = ctx.accounts.market.key();
        bet.user = ctx.accounts.user.key();
        bet.outcome = outcome;
        bet.amount = amount_lamports;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        Ok(())
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_outcome: u8) -> Result<()> {
        require!(
            winning_outcome == 1 || winning_outcome == 2,
            MarketError::InvalidOutcome
        );

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, MarketError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.end_time,
            MarketError::MarketNotExpired
        );

        market.resolved = true;
        market.outcome = winning_outcome;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        require!(market.resolved, MarketError::MarketNotResolved);
        require!(!bet.claimed, MarketError::AlreadyClaimed);
        require!(bet.outcome == market.outcome, MarketError::DidNotWin);

        let winning_side_total = if market.outcome == 1 {
            market.total_viral
        } else {
            market.total_flop
        };

        require!(winning_side_total > 0, MarketError::NoWinners);

        let total_pot = market
            .total_viral
            .checked_add(market.total_flop)
            .ok_or(MarketError::Overflow)?;

        // payout = (user_amount * total_pot) / winning_side_total
        let payout = (bet.amount as u128)
            .checked_mul(total_pot as u128)
            .ok_or(MarketError::Overflow)?
            .checked_div(winning_side_total as u128)
            .ok_or(MarketError::Overflow)? as u64;

        // Transfer from vault to user using PDA signer
        let market_key = market.key();
        let vault_bump = ctx.bumps.vault;
        let vault_seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[vault_bump]];

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;

        let _ = vault_seeds; // seeds used for PDA derivation, direct lamport transfer is safe here

        bet.claimed = true;

        Ok(())
    }
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(content_id: String)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::SPACE,
        seeds = [b"market", content_id.as_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA holds SOL — no data, just lamports
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA receives SOL
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        init,
        payer = user,
        space = BetRecord::SPACE,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, BetRecord>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(
        mut,
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Account<'info, Market>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault PDA pays out SOL
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump = bet.bump,
        has_one = user,
        has_one = market,
    )]
    pub bet: Account<'info, BetRecord>,

    /// CHECK: Receives winnings
    #[account(mut)]
    pub user: AccountInfo<'info>,
}

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
pub struct Market {
    pub content_id: String,  // 4 + 64
    pub title: String,       // 4 + 128
    pub authority: Pubkey,   // 32
    pub total_viral: u64,    // 8
    pub total_flop: u64,     // 8
    pub end_time: i64,       // 8
    pub resolved: bool,      // 1
    pub outcome: u8,         // 1
    pub bump: u8,            // 1
}

impl Market {
    pub const SPACE: usize = 8   // discriminator
        + 4 + 64                  // content_id
        + 4 + 128                 // title
        + 32                      // authority
        + 8                       // total_viral
        + 8                       // total_flop
        + 8                       // end_time
        + 1                       // resolved
        + 1                       // outcome
        + 1;                      // bump
}

#[account]
pub struct BetRecord {
    pub market: Pubkey,   // 32
    pub user: Pubkey,     // 32
    pub outcome: u8,      // 1
    pub amount: u64,      // 8
    pub claimed: bool,    // 1
    pub bump: u8,         // 1
}

impl BetRecord {
    pub const SPACE: usize = 8  // discriminator
        + 32                     // market
        + 32                     // user
        + 1                      // outcome
        + 8                      // amount
        + 1                      // claimed
        + 1;                     // bump
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum MarketError {
    #[msg("Content ID exceeds 64 characters")]
    ContentIdTooLong,
    #[msg("Title exceeds 128 characters")]
    TitleTooLong,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Outcome must be 1 (viral) or 2 (flop)")]
    InvalidOutcome,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Market has already been resolved")]
    MarketAlreadyResolved,
    #[msg("Market betting period has expired")]
    MarketExpired,
    #[msg("Market has not yet expired")]
    MarketNotExpired,
    #[msg("Market has not been resolved yet")]
    MarketNotResolved,
    #[msg("Winnings already claimed")]
    AlreadyClaimed,
    #[msg("Your bet did not win")]
    DidNotWin,
    #[msg("No winners on the winning side")]
    NoWinners,
    #[msg("Arithmetic overflow")]
    Overflow,
}
