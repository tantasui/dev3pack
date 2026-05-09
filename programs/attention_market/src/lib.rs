use anchor_lang::prelude::*;
use anchor_lang::solana_program::{keccak, system_program};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Reveal window: 1 hour after end_time
const REVEAL_WINDOW: i64 = 3600;

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
        market.total_committed = 0;
        market.total_viral = 0;
        market.total_flop = 0;
        market.end_time = clock.unix_timestamp + duration_seconds;
        market.resolved = false;
        market.outcome = 0;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Phase 1 of 2: commit a bet.
    /// Stores a keccak hash of (outcome || secret || user_pubkey) without revealing the side.
    /// SOL is transferred to the vault immediately.
    pub fn commit_bet(
        ctx: Context<CommitBet>,
        commitment: [u8; 32],
        amount_lamports: u64,
    ) -> Result<()> {
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

        market.total_committed = market
            .total_committed
            .checked_add(amount_lamports)
            .ok_or(MarketError::Overflow)?;

        let bet = &mut ctx.accounts.bet;
        bet.market = ctx.accounts.market.key();
        bet.user = ctx.accounts.user.key();
        bet.commitment = commitment;
        bet.amount = amount_lamports;
        bet.revealed = false;
        bet.revealed_outcome = 0;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        Ok(())
    }

    /// Phase 2 of 2: reveal the committed bet.
    /// Must be called after end_time and before end_time + REVEAL_WINDOW.
    /// Validates the preimage matches the stored commitment.
    pub fn reveal_bet(
        ctx: Context<RevealBet>,
        outcome: u8,
        secret: [u8; 32],
    ) -> Result<()> {
        require!(outcome == 1 || outcome == 2, MarketError::InvalidOutcome);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        require!(
            clock.unix_timestamp >= market.end_time,
            MarketError::MarketNotExpired
        );
        require!(
            clock.unix_timestamp < market.end_time + REVEAL_WINDOW,
            MarketError::RevealWindowClosed
        );
        require!(!bet.revealed, MarketError::BetAlreadyRevealed);

        // Recompute commitment: keccak([outcome_byte] ++ secret ++ user_pubkey)
        let computed = keccak::hashv(&[
            &[outcome],
            &secret,
            ctx.accounts.user.key().as_ref(),
        ]);
        require!(computed.0 == bet.commitment, MarketError::InvalidCommitment);

        bet.revealed = true;
        bet.revealed_outcome = outcome;

        if outcome == 1 {
            market.total_viral = market
                .total_viral
                .checked_add(bet.amount)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.total_flop = market
                .total_flop
                .checked_add(bet.amount)
                .ok_or(MarketError::Overflow)?;
        }

        Ok(())
    }

    /// Resolves the market after the reveal window closes.
    /// Outcome is determined automatically by whichever side has more revealed SOL.
    /// Only the market authority can call this.
    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, MarketError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.end_time + REVEAL_WINDOW,
            MarketError::RevealWindowNotClosed
        );

        market.outcome = if market.total_viral >= market.total_flop {
            1 // viral wins (also wins on tie)
        } else {
            2 // flop wins
        };
        market.resolved = true;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        require!(market.resolved, MarketError::MarketNotResolved);
        require!(bet.revealed, MarketError::BetNotRevealed);
        require!(!bet.claimed, MarketError::AlreadyClaimed);
        require!(
            bet.revealed_outcome == market.outcome,
            MarketError::DidNotWin
        );

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

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;

        bet.claimed = true;

        Ok(())
    }
}

// ─── Account contexts ────────────────────────────────────────────────────────

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
pub struct CommitBet<'info> {
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
pub struct RevealBet<'info> {
    #[account(
        mut,
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump = bet.bump,
        has_one = market,
        has_one = user,
    )]
    pub bet: Account<'info, BetRecord>,

    pub user: Signer<'info>,
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
    pub content_id: String,      // 4 + 64
    pub title: String,           // 4 + 128
    pub authority: Pubkey,       // 32
    pub total_committed: u64,    // 8  — total SOL locked (no side info)
    pub total_viral: u64,        // 8  — revealed viral SOL
    pub total_flop: u64,         // 8  — revealed flop SOL
    pub end_time: i64,           // 8
    pub resolved: bool,          // 1
    pub outcome: u8,             // 1
    pub bump: u8,                // 1
}

impl Market {
    pub const SPACE: usize = 8    // discriminator
        + 4 + 64                   // content_id
        + 4 + 128                  // title
        + 32                       // authority
        + 8                        // total_committed
        + 8                        // total_viral
        + 8                        // total_flop
        + 8                        // end_time
        + 1                        // resolved
        + 1                        // outcome
        + 1;                       // bump
}

#[account]
pub struct BetRecord {
    pub market: Pubkey,          // 32
    pub user: Pubkey,            // 32
    pub commitment: [u8; 32],   // 32  — keccak(outcome || secret || user_pubkey)
    pub amount: u64,             // 8
    pub revealed: bool,          // 1
    pub revealed_outcome: u8,    // 1
    pub claimed: bool,           // 1
    pub bump: u8,                // 1
}

impl BetRecord {
    pub const SPACE: usize = 8   // discriminator
        + 32                      // market
        + 32                      // user
        + 32                      // commitment
        + 8                       // amount
        + 1                       // revealed
        + 1                       // revealed_outcome
        + 1                       // claimed
        + 1;                      // bump
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
    #[msg("Market has not yet expired — reveal phase not started")]
    MarketNotExpired,
    #[msg("Reveal window (1hr) has not closed yet")]
    RevealWindowNotClosed,
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
    #[msg("Commitment hash does not match — wrong outcome or secret")]
    InvalidCommitment,
    #[msg("Bet has already been revealed")]
    BetAlreadyRevealed,
    #[msg("Reveal window has closed — bet is forfeited")]
    RevealWindowClosed,
    #[msg("Bet must be revealed before claiming")]
    BetNotRevealed,
}
