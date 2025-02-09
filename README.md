# Solbate

## Inspiration
Solana (SOL) offers countless possibilities to gamify human activities. Online debates are a fascinating social phenomenon, and integrating AI agents (powered by LLMs) into the Solana blockchain opens up new ways to engage online communities. **Solbate** was created to gamify debates among users with SOL wallets in a transparent and decentralized manner.

## What It Does
Solbate allows any user with a SOL wallet to enter a debate against an AI language model (LLM). By providing clear and persuasive arguments, users can win the entire prize pool—funded by donations from other participants in SOL.

## How We Built It
- **Backend**: Node.js and Express  
- **AI**: OpenAI API for LLM tasks  
- **Database**: MySQL on AWS RDS, managed with Prisma CLI  
- **Blockchain**: A Rust-based Solana smart contract deployed to Solana Devnet  
- **Frontend**: React, leveraging libraries such as `@solana/web3.js` and Phantom Wallet Adapter for wallet integration

## Challenges We Ran Into
It was my first time working with the Solana blockchain. While Anchor deployment tools presented some difficulties, using alternative Solana tooling eventually helped deploy the smart contract on Devnet successfully.

## Accomplishments
We built a fully functional platform showcasing a decentralized and transparent smart contract on Solana. This project highlights how blockchain can enhance social interactions in a fun and engaging way.

## What We Learned
- In-depth Solana development and deployment
- Integrating wallet functionality into web apps
- Coordinating AI-based debate logic with on-chain transactions

## What's Next
- **Team vs. Team Debates**: Expand debates to two teams of real users  
- **Judging**: Allow an LLM to act as the judge or replace it entirely with a voting mechanism in the Solana smart contract  
