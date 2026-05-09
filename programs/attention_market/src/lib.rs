use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_lang::system_program::{self, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ─── Constants ────────────────────────────────────────────────────────────────

const REVEAL_WINDOW: i64 = 3600;
const WHALE_THRESHOLD_LAMPORTS: u64 = 1_000_000_000; // 1 SOL
const PROTOCOL_FEE_BPS: u64 = 200;                   // 2%
const CREATOR_FEE_BPS: u64 = 300;                    // 3%

#[program]
pub mod attention_market {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        content_id: String,
        title: String,
        duration_seconds: i64,
        mode: u8,
    ) -> Result<()> {
        require!(content_id.len() <= 64, MarketError::ContentIdTooLong);
        require!(title.len() <= 128, MarketError::TitleTooLong);
        require!(duration_seconds > 0, MarketError::InvalidDuration);
        require!(mode == 0 || mode == 1, MarketError::InvalidMode);

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        market.content_id = content_id;
        market.title = title;
        market.authority = ctx.accounts.authority.key();
        market.creator = ctx.accounts.authority.key();
        market.protocol_treasury = ctx.accounts.protocol_treasury.key();
        market.mode = mode;
        market.total_committed = 0;
        market.total_pot = 0;
        market.total_viral = 0;
        market.total_flop = 0;
        market.viral_count = 0;
        market.flop_count = 0;
        market.comment_count = 0;
        market.end_time = clock.unix_timestamp + duration_seconds;
        market.early_window_end = clock.unix_timestamp + duration_seconds / 10;
        market.resolved = false;
        market.outcome = 0;
        market.winner_pool = 0;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Phase 1: commit a bet (side hidden). Emits WhaleBet event for large bets.
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

        // SOL to vault
        let cpi_accounts = Transfer {
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
        market.total_pot = market.total_committed;

        // Record whether this is an early bet
        let is_early = clock.unix_timestamp <= market.early_window_end;

        let bet = &mut ctx.accounts.bet;
        bet.market = ctx.accounts.market.key();
        bet.user = ctx.accounts.user.key();
        bet.commitment = commitment;
        bet.amount = amount_lamports;
        bet.is_early = is_early;
        bet.revealed = false;
        bet.revealed_outcome = 0;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        // Init UserStats on first bet (init_if_needed handles existing accounts)
        let stats = &mut ctx.accounts.user_stats;
        if stats.user == Pubkey::default() {
            stats.user = ctx.accounts.user.key();
            stats.total_bets = 0;
            stats.total_wins = 0;
            stats.bump = ctx.bumps.user_stats;
        }

        // Whale alert
        if amount_lamports >= WHALE_THRESHOLD_LAMPORTS {
            emit!(WhaleBet {
                market: ctx.accounts.market.key(),
                amount: amount_lamports,
                timestamp: clock.unix_timestamp,
            });
        }

        Ok(())
    }

    /// Phase 2: reveal committed bet within the 1-hour reveal window.
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

        // Validate preimage: keccak([outcome] ++ secret ++ user_pubkey)
        let computed = keccak::hashv(&[
            &[outcome],
            &secret,
            ctx.accounts.user.key().as_ref(),
        ]);
        require!(computed.0 == bet.commitment, MarketError::InvalidCommitment);

        bet.revealed = true;
        bet.revealed_outcome = outcome;

        // Accumulate SOL totals and headcounts
        if outcome == 1 {
            market.total_viral = market
                .total_viral
                .checked_add(bet.amount)
                .ok_or(MarketError::Overflow)?;
            market.viral_count = market
                .viral_count
                .checked_add(1)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.total_flop = market
                .total_flop
                .checked_add(bet.amount)
                .ok_or(MarketError::Overflow)?;
            market.flop_count = market
                .flop_count
                .checked_add(1)
                .ok_or(MarketError::Overflow)?;
        }

        // Track bets in UserStats
        ctx.accounts.user_stats.total_bets = ctx
            .accounts
            .user_stats
            .total_bets
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;

        Ok(())
    }

    /// Resolves market after reveal window. Winner = side with higher headcount.
    /// Mode 0 (majority): more wallets wins. Mode 1 (minority): fewer wallets wins.
    /// Extracts protocol and creator fees from vault before setting winner_pool.
    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        require!(!market.resolved, MarketError::MarketAlreadyResolved);
        require!(
            clock.unix_timestamp >= market.end_time + REVEAL_WINDOW,
            MarketError::RevealWindowNotClosed
        );

        // Validate fee recipient accounts match market storage
        require!(
            ctx.accounts.protocol_treasury.key() == market.protocol_treasury,
            MarketError::TreasuryMismatch
        );
        require!(
            ctx.accounts.creator.key() == market.creator,
            MarketError::CreatorMismatch
        );

        // Determine winner by headcount
        let viral_wins_majority = market.viral_count >= market.flop_count;
        market.outcome = match market.mode {
            0 => if viral_wins_majority { 1 } else { 2 }, // majority
            1 => if viral_wins_majority { 2 } else { 1 }, // minority (inverted)
            _ => 1,
        };
        market.resolved = true;

        // Extract fees from vault
        let total = market.total_committed;
        let protocol_cut = total * PROTOCOL_FEE_BPS / 10_000;
        let creator_cut = total * CREATOR_FEE_BPS / 10_000;
        market.winner_pool = total
            .checked_sub(protocol_cut)
            .and_then(|v| v.checked_sub(creator_cut))
            .ok_or(MarketError::Overflow)?;

        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        require!(vault_lamports >= protocol_cut + creator_cut, MarketError::InsufficientFunds);

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= protocol_cut + creator_cut;
        **ctx.accounts.protocol_treasury.to_account_info().try_borrow_mut_lamports()? += protocol_cut;
        **ctx.accounts.creator.to_account_info().try_borrow_mut_lamports()? += creator_cut;

        Ok(())
    }

    /// Claim proportional share of winner_pool. Early bettors get 1.2x.
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

        let winner_pool = market.winner_pool;

        // base = amount * winner_pool / winning_side_total
        let base = (bet.amount as u128)
            .checked_mul(winner_pool as u128)
            .ok_or(MarketError::Overflow)?
            .checked_div(winning_side_total as u128)
            .ok_or(MarketError::Overflow)? as u64;

        // 1.2x early bonus via basis points (12000 / 10000)
        let raw_payout = if bet.is_early {
            base.checked_mul(12_000)
                .ok_or(MarketError::Overflow)?
                .checked_div(10_000)
                .ok_or(MarketError::Overflow)?
        } else {
            base
        };

        let vault_balance = ctx.accounts.vault.to_account_info().lamports();
        require!(raw_payout <= vault_balance, MarketError::InsufficientFunds);
        let payout = raw_payout;

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += payout;

        bet.claimed = true;

        // Track win in UserStats
        ctx.accounts.user_stats.total_wins = ctx
            .accounts
            .user_stats
            .total_wins
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;

        Ok(())
    }

    /// Post a permanent on-chain comment to any active market.
    pub fn post_comment(
        ctx: Context<PostComment>,
        content: String,
        comment_index: u64,
    ) -> Result<()> {
        require!(!content.is_empty(), MarketError::CommentEmpty);
        require!(content.len() <= 280, MarketError::CommentTooLong);
        require!(
            comment_index == ctx.accounts.market.comment_count,
            MarketError::InvalidCommentIndex
        );

        let clock = Clock::get()?;
        let market = &mut ctx.accounts.market;

        let comment = &mut ctx.accounts.comment;
        comment.market = market.key();
        comment.author = ctx.accounts.author.key();
        comment.content = content;
        comment.timestamp = clock.unix_timestamp;
        comment.bump = ctx.bumps.comment;

        market.comment_count = market
            .comment_count
            .checked_add(1)
            .ok_or(MarketError::Overflow)?;

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

    /// CHECK: Vault PDA holds SOL
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Protocol treasury address stored on market
    pub protocol_treasury: AccountInfo<'info>,

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

    /// CHECK: Vault receives SOL
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

    #[account(
        init_if_needed,
        payer = user,
        space = UserStats::SPACE,
        seeds = [b"stats", user.key().as_ref()],
        bump
    )]
    pub user_stats: Account<'info, UserStats>,

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

    #[account(
        mut,
        seeds = [b"stats", user.key().as_ref()],
        bump = user_stats.bump,
    )]
    pub user_stats: Account<'info, UserStats>,

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

    /// CHECK: Vault pays out fees
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Must match market.protocol_treasury
    #[account(mut)]
    pub protocol_treasury: AccountInfo<'info>,

    /// CHECK: Must match market.creator
    #[account(mut)]
    pub creator: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: Vault pays out winners
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

    #[account(
        mut,
        seeds = [b"stats", user.key().as_ref()],
        bump = user_stats.bump,
    )]
    pub user_stats: Account<'info, UserStats>,

    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(content: String, comment_index: u64)]
pub struct PostComment<'info> {
    #[account(
        mut,
        seeds = [b"market", market.content_id.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = author,
        space = Comment::SPACE,
        seeds = [b"comment", market.key().as_ref(), &comment_index.to_le_bytes()],
        bump
    )]
    pub comment: Account<'info, Comment>,

    #[account(mut)]
    pub author: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── State accounts ───────────────────────────────────────────────────────────

#[account]
pub struct Market {
    pub content_id: String,          // 4+64
    pub title: String,               // 4+128
    pub authority: Pubkey,           // 32
    pub creator: Pubkey,             // 32  — receives 3% fee
    pub protocol_treasury: Pubkey,   // 32  — receives 2% fee
    pub mode: u8,                    // 1   — 0=majority, 1=minority
    pub total_committed: u64,        // 8   — SOL locked (no side info)
    pub total_pot: u64,              // 8   — mirrors total_committed
    pub total_viral: u64,            // 8   — revealed viral SOL
    pub total_flop: u64,             // 8   — revealed flop SOL
    pub viral_count: u64,            // 8   — unique wallets revealed viral
    pub flop_count: u64,             // 8   — unique wallets revealed flop
    pub comment_count: u64,          // 8   — sequential comment index
    pub end_time: i64,               // 8
    pub early_window_end: i64,       // 8   — first 10% of duration
    pub resolved: bool,              // 1
    pub outcome: u8,                 // 1   — 0=unresolved, 1=viral, 2=flop
    pub winner_pool: u64,            // 8   — total_committed minus fees
    pub bump: u8,                    // 1
}

impl Market {
    pub const SPACE: usize = 8       // discriminator
        + 4 + 64                      // content_id
        + 4 + 128                     // title
        + 32                          // authority
        + 32                          // creator
        + 32                          // protocol_treasury
        + 1                           // mode
        + 8                           // total_committed
        + 8                           // total_pot
        + 8                           // total_viral
        + 8                           // total_flop
        + 8                           // viral_count
        + 8                           // flop_count
        + 8                           // comment_count
        + 8                           // end_time
        + 8                           // early_window_end
        + 1                           // resolved
        + 1                           // outcome
        + 8                           // winner_pool
        + 1;                          // bump
}

#[account]
pub struct BetRecord {
    pub market: Pubkey,          // 32
    pub user: Pubkey,            // 32
    pub commitment: [u8; 32],   // 32
    pub amount: u64,             // 8
    pub is_early: bool,          // 1   — committed within early window
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
        + 1                       // is_early
        + 1                       // revealed
        + 1                       // revealed_outcome
        + 1                       // claimed
        + 1;                      // bump
}

#[account]
pub struct Comment {
    pub market: Pubkey,     // 32
    pub author: Pubkey,     // 32
    pub content: String,    // 4+280
    pub timestamp: i64,     // 8
    pub bump: u8,           // 1
}

impl Comment {
    pub const SPACE: usize = 8   // discriminator
        + 32                      // market
        + 32                      // author
        + 4 + 280                 // content
        + 8                       // timestamp
        + 1;                      // bump
}

#[account]
pub struct UserStats {
    pub user: Pubkey,       // 32
    pub total_bets: u64,    // 8
    pub total_wins: u64,    // 8
    pub bump: u8,           // 1
}

impl UserStats {
    pub const SPACE: usize = 8   // discriminator
        + 32                      // user
        + 8                       // total_bets
        + 8                       // total_wins
        + 1;                      // bump
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[event]
pub struct WhaleBet {
    pub market: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
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
    #[msg("Mode must be 0 (majority) or 1 (minority)")]
    InvalidMode,
    #[msg("Comment exceeds 280 characters")]
    CommentTooLong,
    #[msg("Comment index does not match market comment_count")]
    InvalidCommentIndex,
    #[msg("Protocol treasury account does not match market record")]
    TreasuryMismatch,
    #[msg("Creator account does not match market record")]
    CreatorMismatch,
    #[msg("Vault has insufficient balance for payout or fee extraction")]
    InsufficientFunds,
    #[msg("Comment content cannot be empty")]
    CommentEmpty,
}
