use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

declare_id!("9JTUfhRAejqktmCAfdyEToCkHBTyRn2PHWCaBjMWwe3z");

#[program]
pub mod token_escrow {
    use super::*;

    pub fn create_escrow(ctx: Context<CreateEscrow>, amount: u64, item_name: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.item_name = item_name.clone();
        escrow.is_completed = false;
        escrow.bump = ctx.bumps.escrow;

        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        msg!("Escrow Created {} tokens locked for {}", amount, item_name);
        msg!("Buyer {}", ctx.accounts.buyer.key());
        msg!("Seller {}", ctx.accounts.seller.key());

        Ok(())
    }

    pub fn complete_escrow(ctx: Context<CompleteEscrow>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        let item_name = ctx.accounts.escrow.item_name.clone();
        let buyer_key = ctx.accounts.escrow.buyer;
        let seller_key = ctx.accounts.escrow.seller;
        let bump = ctx.accounts.escrow.bump;

        require!(
            !ctx.accounts.escrow.is_completed,
            EscrowError::AlreadyCompleted
        );

        let escrow_seeds: &[&[u8]] = &[b"escrow", buyer_key.as_ref(), seller_key.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[&escrow_seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.seller_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.escrow.is_completed = true;

        msg!("✅ Escrow completed! {} tokens sent to seller", amount);
        msg!("📦 Item '{}' transaction finished", item_name);

        Ok(())
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        let buyer_key = ctx.accounts.escrow.buyer;
        let seller_key = ctx.accounts.escrow.seller;
        let bump = ctx.accounts.escrow.bump;

        require!(
            !ctx.accounts.escrow.is_completed,
            EscrowError::AlreadyCompleted
        );

        require!(
            ctx.accounts.buyer.key() == buyer_key,
            EscrowError::UnauthorizedCancel
        );

        let escrow_seeds: &[&[u8]] = &[b"escrow", buyer_key.as_ref(), seller_key.as_ref(), &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[&escrow_seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.buyer_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.escrow.is_completed = true;

        msg!("❌ Escrow cancelled! {} tokens refunded to buyer", amount);

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, item_name: String)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = buyer,
        space = Escrow::SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = escrow, // Escrow PDA owns this account!
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Seller doesn't need to sign for escrow creation
    pub seller: UncheckedAccount<'info>,

    pub mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CompleteEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = seller
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub seller: Signer<'info>,

    pub mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub buyer: Signer<'info>,

    pub mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub item_name: String,
    pub is_completed: bool,
    pub bump: u8,
}

impl Escrow {
    const SPACE: usize = 8 + 32 + 32 + 8 + (4 + 50) + 1 + 1;
}

#[error_code]
pub enum EscrowError {
    #[msg("This escrow has already been completed")]
    AlreadyCompleted,
    #[msg("Only the buyer can cancel the escrow")]
    UnauthorizedCancel,
}