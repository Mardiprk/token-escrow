import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TokenEscrow } from "../target/types/token_escrow";
import {TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,} from "@solana/spl-token";
import { expect } from "chai";

  describe("token-escrow", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
  
    const program = anchor.workspace.TokenEscrow as Program<TokenEscrow>;
  
    // Test accounts
    let buyer: anchor.web3.Keypair;
    let seller: anchor.web3.Keypair;
    let mint: anchor.web3.PublicKey;
    let buyerTokenAccount: anchor.web3.PublicKey;
    let sellerTokenAccount: anchor.web3.PublicKey;
    
    // PDAs
    let escrowPda: anchor.web3.PublicKey;
    let escrowBump: number;
    let vaultPda: anchor.web3.PublicKey;
    let vaultBump: number;
  
    const ESCROW_AMOUNT = 1000;
    const ITEM_NAME = "iPhone 15 Pro";
  
    beforeEach(async () => {
      // Create test keypairs
      buyer = anchor.web3.Keypair.generate();
      seller = anchor.web3.Keypair.generate();
  
      // Airdrop SOL to accounts
      await provider.connection.requestAirdrop(buyer.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.requestAirdrop(seller.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
      
      // Wait for airdrop confirmations
      await new Promise(resolve => setTimeout(resolve, 1000));
  
      // Create mint
      mint = await createMint(
        provider.connection,
        buyer, // payer
        buyer.publicKey, // mint authority
        buyer.publicKey, // freeze authority
        6 // decimals
      );
  
      // Create token accounts
      buyerTokenAccount = await createAccount(
        provider.connection,
        buyer,
        mint,
        buyer.publicKey
      );
  
      sellerTokenAccount = await createAccount(
        provider.connection,
        seller,
        mint,
        seller.publicKey
      );
  
      // Mint tokens to buyer
      await mintTo(
        provider.connection,
        buyer,
        mint,
        buyerTokenAccount,
        buyer.publicKey,
        ESCROW_AMOUNT * 2 // Give buyer 2x the escrow amount
      );
  
      // Calculate PDAs
      [escrowPda, escrowBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          buyer.publicKey.toBuffer(),
          seller.publicKey.toBuffer(),
        ],
        program.programId
      );
  
      [vaultPda, vaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("vault"),
          escrowPda.toBuffer(),
        ],
        program.programId
      );
    });
  
    describe("🛒 Create Escrow", () => {
      it("✅ Should create escrow and transfer tokens to vault", async () => {
        // Get initial balances
        const initialBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        
        // Create escrow
        await program.methods
          .createEscrow(new anchor.BN(ESCROW_AMOUNT), ITEM_NAME)
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
  
        // Check escrow account data
        const escrowAccount = await program.account.escrow.fetch(escrowPda);
        expect(escrowAccount.buyer.toString()).to.equal(buyer.publicKey.toString());
        expect(escrowAccount.seller.toString()).to.equal(seller.publicKey.toString());
        expect(escrowAccount.amount.toNumber()).to.equal(ESCROW_AMOUNT);
        expect(escrowAccount.itemName).to.equal(ITEM_NAME);
        expect(escrowAccount.isCompleted).to.be.false;
        expect(escrowAccount.bump).to.equal(escrowBump);
  
        // Check token balances
        const finalBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const vaultBalance = await getAccount(provider.connection, vaultPda);
  
        expect(Number(finalBuyerBalance.amount)).to.equal(
          Number(initialBuyerBalance.amount) - ESCROW_AMOUNT
        );
        expect(Number(vaultBalance.amount)).to.equal(ESCROW_AMOUNT);
      });
  
      it("❌ Should fail if buyer doesn't have enough tokens", async () => {
        try {
          await program.methods
            .createEscrow(new anchor.BN(ESCROW_AMOUNT * 10), ITEM_NAME) // Too much
            .accounts({
              escrow: escrowPda,
              escrowVault: vaultPda,
              buyerTokenAccount: buyerTokenAccount,
              buyer: buyer.publicKey,
              seller: seller.publicKey,
              mint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: anchor.web3.SystemProgram.programId,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([buyer])
            .rpc();
  
          expect.fail("Should have failed due to insufficient tokens");
        } catch (error) {
          expect(error.toString()).to.include("insufficient funds");
        }
      });
    });
  
    describe("✅ Complete Escrow", () => {
      beforeEach(async () => {
        // Create escrow first
        await program.methods
          .createEscrow(new anchor.BN(ESCROW_AMOUNT), ITEM_NAME)
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
      });
  
      it("✅ Should complete escrow and transfer tokens to seller", async () => {
        // Get initial balances
        const initialSellerBalance = await getAccount(provider.connection, sellerTokenAccount);
        const initialVaultBalance = await getAccount(provider.connection, vaultPda);
  
        // Complete escrow
        await program.methods
          .completeEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            sellerTokenAccount: sellerTokenAccount,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();
  
        // Check escrow is marked as completed
        const escrowAccount = await program.account.escrow.fetch(escrowPda);
        expect(escrowAccount.isCompleted).to.be.true;
  
        // Check token balances
        const finalSellerBalance = await getAccount(provider.connection, sellerTokenAccount);
        const finalVaultBalance = await getAccount(provider.connection, vaultPda);
  
        expect(Number(finalSellerBalance.amount)).to.equal(
          Number(initialSellerBalance.amount) + ESCROW_AMOUNT
        );
        expect(Number(finalVaultBalance.amount)).to.equal(0);
      });
  
      it("❌ Should fail if non-seller tries to complete", async () => {
        try {
          await program.methods
            .completeEscrow()
            .accounts({
              escrow: escrowPda,
              escrowVault: vaultPda,
              sellerTokenAccount: sellerTokenAccount,
              seller: buyer.publicKey, // Wrong signer!
              mint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([buyer]) // Wrong signer!
            .rpc();
  
          expect.fail("Should have failed with wrong signer");
        } catch (error) {
          expect(error.toString()).to.include("unknown signer");
        }
      });
  
      it("❌ Should fail if escrow already completed", async () => {
        // Complete escrow first time
        await program.methods
          .completeEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            sellerTokenAccount: sellerTokenAccount,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();
  
        // Try to complete again
        try {
          await program.methods
            .completeEscrow()
            .accounts({
              escrow: escrowPda,
              escrowVault: vaultPda,
              sellerTokenAccount: sellerTokenAccount,
              seller: seller.publicKey,
              mint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([seller])
            .rpc();
  
          expect.fail("Should have failed - already completed");
        } catch (error) {
          expect(error.toString()).to.include("AlreadyCompleted");
        }
      });
    });
  
    describe("❌ Cancel Escrow", () => {
      beforeEach(async () => {
        // Create escrow first
        await program.methods
          .createEscrow(new anchor.BN(ESCROW_AMOUNT), ITEM_NAME)
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
      });
  
      it("✅ Should cancel escrow and refund tokens to buyer", async () => {
        // Get initial balances
        const initialBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const initialVaultBalance = await getAccount(provider.connection, vaultPda);
  
        // Cancel escrow
        await program.methods
          .cancelEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
  
        // Check escrow is marked as completed (cancelled)
        const escrowAccount = await program.account.escrow.fetch(escrowPda);
        expect(escrowAccount.isCompleted).to.be.true;
  
        // Check token balances
        const finalBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const finalVaultBalance = await getAccount(provider.connection, vaultPda);
  
        expect(Number(finalBuyerBalance.amount)).to.equal(
          Number(initialBuyerBalance.amount) + ESCROW_AMOUNT
        );
        expect(Number(finalVaultBalance.amount)).to.equal(0);
      });
  
      it("❌ Should fail if non-buyer tries to cancel", async () => {
        try {
          await program.methods
            .cancelEscrow()
            .accounts({
              escrow: escrowPda,
              escrowVault: vaultPda,
              buyerTokenAccount: buyerTokenAccount,
              buyer: seller.publicKey, // Wrong signer!
              mint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([seller]) // Wrong signer!
            .rpc();
  
          expect.fail("Should have failed - unauthorized cancel");
        } catch (error) {
          expect(error.toString()).to.include("UnauthorizedCancel");
        }
      });
  
      it("❌ Should fail if escrow already completed", async () => {
        // Complete escrow first
        await program.methods
          .completeEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            sellerTokenAccount: sellerTokenAccount,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();
  
        // Try to cancel
        try {
          await program.methods
            .cancelEscrow()
            .accounts({
              escrow: escrowPda,
              escrowVault: vaultPda,
              buyerTokenAccount: buyerTokenAccount,
              buyer: buyer.publicKey,
              mint: mint,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([buyer])
            .rpc();
  
          expect.fail("Should have failed - already completed");
        } catch (error) {
          expect(error.toString()).to.include("AlreadyCompleted");
        }
      });
    });
  
    describe("🔍 Integration Tests", () => {
      it("✅ Full happy path: Create → Complete", async () => {
        const initialBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const initialSellerBalance = await getAccount(provider.connection, sellerTokenAccount);
  
        // 1. Create escrow
        await program.methods
          .createEscrow(new anchor.BN(ESCROW_AMOUNT), ITEM_NAME)
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
  
        // 2. Complete escrow
        await program.methods
          .completeEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            sellerTokenAccount: sellerTokenAccount,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();
  
        // 3. Verify final state
        const finalBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const finalSellerBalance = await getAccount(provider.connection, sellerTokenAccount);
        const finalVaultBalance = await getAccount(provider.connection, vaultPda);
  
        // Buyer should have lost tokens
        expect(Number(finalBuyerBalance.amount)).to.equal(
          Number(initialBuyerBalance.amount) - ESCROW_AMOUNT
        );
  
        // Seller should have gained tokens
        expect(Number(finalSellerBalance.amount)).to.equal(
          Number(initialSellerBalance.amount) + ESCROW_AMOUNT
        );
  
        // Vault should be empty
        expect(Number(finalVaultBalance.amount)).to.equal(0);
      });
  
      it("✅ Full refund path: Create → Cancel", async () => {
        const initialBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
  
        // 1. Create escrow
        await program.methods
          .createEscrow(new anchor.BN(ESCROW_AMOUNT), ITEM_NAME)
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            seller: seller.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([buyer])
          .rpc();
  
        // 2. Cancel escrow
        await program.methods
          .cancelEscrow()
          .accounts({
            escrow: escrowPda,
            escrowVault: vaultPda,
            buyerTokenAccount: buyerTokenAccount,
            buyer: buyer.publicKey,
            mint: mint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();
  
        // 3. Verify final state
        const finalBuyerBalance = await getAccount(provider.connection, buyerTokenAccount);
        const finalVaultBalance = await getAccount(provider.connection, vaultPda);
  
        // Buyer should have all tokens back
        expect(Number(finalBuyerBalance.amount)).to.equal(Number(initialBuyerBalance.amount));
  
        // Vault should be empty
        expect(Number(finalVaultBalance.amount)).to.equal(0);
      });
    });
  });