import React, { useState } from "react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@project-serum/anchor";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import {
    WalletMultiButton,
    WalletDisconnectButton,
} from "@solana/wallet-adapter-react-ui";
import idl from "../idl.json"; // The generated IDL from your Rust program

// Ensure Buffer is available globally
if (typeof window !== "undefined") {
    window.Buffer = window.Buffer || require("buffer").Buffer;
}

// The program ID from your Anchor contract (declare_id! in Rust)
const programID = new PublicKey("9yWdnTPixhspj8fV5JqvrkW4dzTBVcuVDMaqs5wafyYz");

// Devnet endpoint
const network = "https://api.devnet.solana.com";

// Commitment option
const opts = {
    preflightCommitment: "processed",
};

function Test() {
    // The Anchor wallet hook gives us the connected wallet context
    const wallet = useAnchorWallet();
    const { connected } = useWallet();

    // Local UI state
    const [error, setError] = useState("");
    const [bankPda, setBankPda] = useState(null);
    const [depositAmount, setDepositAmount] = useState("");
    const [winnerAddress, setWinnerAddress] = useState("");

    // Utility to get the AnchorProvider
    const getProvider = () => {
        if (!wallet) return null;
        const connection = new Connection(network, opts.preflightCommitment);
        return new AnchorProvider(connection, wallet, opts);
    };

    // Helper to find the PDA for the bank (seed = "bank")
    const findBankPda = async () => {
        return await PublicKey.findProgramAddress(
            [Buffer.from("bank")],
            programID
        );
    };

    // ----------------------
    //  1) Initialize the bank
    // ----------------------
    const initializeBank = async () => {
        setError("");

        if (!connected) {
            setError("Wallet is not connected.");
            return;
        }

        const provider = getProvider();
        if (!provider) {
            setError("Provider is not available.");
            return;
        }

        const program = new Program(idl, programID, provider);

        try {
            // Derive our bank PDA
            const [pda, _bump] = await findBankPda();

            // Anchor "methods" syntax is the modern approach (instead of program.rpc.xyz)
            await program.methods
                .initialize() // our Rust fn name
                .accounts({
                    bank: pda,
                    owner: provider.wallet.publicKey, // your connected wallet
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log("Bank initialized at PDA:", pda.toBase58());
            setBankPda(pda.toBase58());
        } catch (err) {
            console.error("Error initializing bank:", err);
            setError("Failed to initialize bank. Please try again.");
        }
    };

    // ----------------------
    //  2) Deposit into the bank
    // ----------------------
    const depositToBank = async () => {
        setError("");

        if (!connected) {
            setError("Wallet is not connected.");
            return;
        }

        const provider = getProvider();
        if (!provider) {
            setError("Provider is not available.");
            return;
        }

        const program = new Program(idl, programID, provider);
        const [bankPda] = await findBankPda();

        try {
            // Convert depositAmount (string) to BN
            const lamports = new BN(depositAmount);

            await program.methods
                .deposit(lamports)
                .accounts({
                    user: provider.wallet.publicKey, // who is depositing
                    bank: new PublicKey(bankPda),
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log(`Deposited ${depositAmount} lamports!`);
        } catch (err) {
            console.error("Error depositing:", err);
            setError("Failed to deposit. Please try again.");
        }
    };

    // ----------------------
    //  3) Payout from the bank
    // ----------------------
    const payoutFromBank = async () => {
        setError("");

        if (!connected) {
            setError("Wallet is not connected.");
            return;
        }

        if (!winnerAddress) {
            setError("Winner address is empty.");
            return;
        }

        const provider = getProvider();
        if (!provider) {
            setError("Provider is not available.");
            return;
        }

        const program = new Program(idl, programID, provider);
        const [bankPda] = await findBankPda();

        try {
            await program.methods
                .payout()
                .accounts({
                    bank: bankPda, // Corrected to use the bankPda directly
                    owner: provider.wallet.publicKey, // must be bank owner
                    winner: new PublicKey(winnerAddress),
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            console.log("Payout executed!");
        } catch (err) {
            console.error("Error during payout:", err);
            setError("Failed to payout. Please try again.");
        }
    };

    return (
        <div style={{ padding: "1rem" }}>
            <h1>Solana Bank DApp (Devnet)</h1>

            <div style={{ marginBottom: "1rem" }}>
                <WalletMultiButton />
                <WalletDisconnectButton />
            </div>

            <button onClick={initializeBank}>Initialize Bank</button>
            {bankPda && (
                <p>
                    <strong>Bank PDA:</strong> {bankPda}
                </p>
            )}

            <div style={{ marginTop: "1rem" }}>
                <h3>Deposit</h3>
                <input
                    type="number"
                    placeholder="Lamports to deposit"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                />
                <button onClick={depositToBank}>Deposit</button>
            </div>

            <div style={{ marginTop: "1rem" }}>
                <h3>Payout</h3>
                <input
                    type="text"
                    placeholder="Winner SOL address"
                    value={winnerAddress}
                    onChange={(e) => setWinnerAddress(e.target.value)}
                />
                <button onClick={payoutFromBank}>Payout</button>
            </div>

            {error && (
                <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>
            )}
        </div>
    );
}

export default Test;
