use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    system_instruction,
    program::{invoke},
    rent::Rent,
};

declare_id!("9yWdnTPixhspj8fV5JqvrkW4dzTBVcuVDMaqs5wafyYz");

#[program]
pub mod common_bank {
    use super::*;

    /// Initializes the bank. This creates a PDA (with seed "bank") that will hold deposited funds.
    /// The caller becomes the owner.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let bank = &mut ctx.accounts.bank;
        bank.owner = *ctx.accounts.owner.key;
        // Instead of indexing into ctx.bumps with a string,
        // use dot notation to get the bump for the "bank" account.
        bank.bump = ctx.bumps.bank;
        Ok(())
    }

    /// Anyone can call this function to deposit SOL into the bank.
    /// The deposit is implemented by calling the system program’s transfer instruction.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let ix = system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.bank.key(),
            amount,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.bank.to_account_info(),
            ],
        )?;
        Ok(())
    }

    /// When the owner calls this function, the bank’s funds (beyond the rent-exempt minimum)
    /// are split: 10% is sent to the owner and 90% is sent to the winner account provided.
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let bank = &mut ctx.accounts.bank;

        // Only owner can call
        if ctx.accounts.owner.key() != bank.owner {
            return Err(ErrorCode::Unauthorized.into());
        }

        let bank_info = ctx.accounts.bank.to_account_info();
        let bank_balance = bank_info.lamports();
        let rent = Rent::get()?;
        let rent_exempt = rent.minimum_balance(bank_info.data_len());

        if bank_balance <= rent_exempt {
            return Err(ErrorCode::InsufficientFundsForPayout.into());
        }

        let available = bank_balance - rent_exempt;
        let owner_share = available / 10;           // 10%
        let winner_share = available - owner_share; // 90%

        // Debit the bank
        **ctx.accounts.bank.to_account_info().try_borrow_mut_lamports()? -= available;

        // Credit the owner
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += owner_share;

        // Credit the winner
        **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += winner_share;

        Ok(())
    }
}

/// Accounts used in the initialize instruction.
/// The bank account is created as a PDA with seed "bank" (and its bump stored),
/// and the payer (the owner) funds its creation.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init, 
        payer = owner, 
        space = 8 + 32 + 1,    // discriminator + owner (32 bytes) + bump (1 byte)
        seeds = [b"bank"],
        bump
    )]
    pub bank: Account<'info, Bank>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Accounts used for a deposit. Any user may deposit SOL into the bank.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// The bank PDA (with seed "bank") that holds the funds.
    #[account(mut, seeds = [b"bank"], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    pub system_program: Program<'info, System>,
}

/// Accounts for the payout instruction. Only the owner (who is stored in the bank state)
/// may trigger a payout. The winner account is provided by the owner.
#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut, seeds = [b"bank"], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: The winner account is not verified by this program.
    #[account(mut)]
    pub winner: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// The Bank account holds the owner’s public key and the bump seed used for the PDA.
#[account]
pub struct Bank {
    pub owner: Pubkey,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Caller is not the owner of the contract")]
    Unauthorized,
    #[msg("Not enough funds in the bank for payout")]
    InsufficientFundsForPayout,
}
