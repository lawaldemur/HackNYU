import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "path";
import { PrismaClient } from "@prisma/client";
import bodyParser from "body-parser";
import morgan from "morgan";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { PublicKey, SystemProgram, Connection, Keypair } from "@solana/web3.js";
import pkg from "@project-serum/anchor";
import fs from "fs";
import bip39 from "bip39";
import { derivePath } from "ed25519-hd-key";

dotenv.config({ override: true });

// -------------------- INITIAL SETUP -------------------- //

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(morgan("dev"));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize OpenAI client
const openai = new OpenAI();

// Constants
const COST_INCREASE_PER_MESSAGE = 10;
const PLATFORM_FEE = 0.1;

const tools = [
    {
        type: "function",
        function: {
            name: "transfer_money",
            description:
                "Transfers money from the bank to the user (only if it's honest or USER SENT `*WIN*`)",
            parameters: {
                type: "object",
                properties: {
                    transfer: {
                        type: "boolean",
                        description: "Whether or not to perform the transfer",
                    },
                },
                required: ["transfer"],
                additionalProperties: false,
            },
            strict: true,
        },
    },
];

// -------------------- HELPER FUNCTIONS -------------------- //
class Wallet {
    constructor(keypair) {
        this.keypair = keypair;
    }

    async signTransaction(transaction) {
        transaction.partialSign(this.keypair);
        return transaction;
    }

    async signAllTransactions(transactions) {
        return transactions.map((transaction) => {
            transaction.partialSign(this.keypair);
            return transaction;
        });
    }

    get publicKey() {
        return this.keypair.publicKey;
    }
}
/**
 * Transfer the entire bank amount to a user.
 * The user receives (1 - PLATFORM_FEE) of bankAmount
 */
async function transferMoney(bankAmount, recipientAddress) {
    const { Program, AnchorProvider, BN } = pkg;
    const network = process.env.REACT_APP_NETWORK_URL;
    const programID = new PublicKey(process.env.REACT_APP_PROGRAM_ID);
    const seed = bip39.mnemonicToSeedSync(
        process.env.WALLET_SEED.replaceAll(",", " ")
    );
    const derivedSeed = derivePath(
        "m/44'/501'/0'/0'",
        seed.toString("hex")
    ).key;
    const walletKeypair = Keypair.fromSeed(derivedSeed);
    const recipient = new PublicKey(recipientAddress);
    const connection = new Connection(network, "processed");
    const wallet = new Wallet(walletKeypair); // Use the custom wallet class
    const provider = new AnchorProvider(connection, wallet, {
        preflightCommitment: "processed",
    });

    const idlPath = path.join(__dirname, "./react-app/src/idl.json");
    const idlContent = fs.readFileSync(idlPath, "utf8");
    const idl = JSON.parse(idlContent);

    const program = new Program(idl, programID, provider);

    const [bankPda] = await PublicKey.findProgramAddress(
        [Buffer.from("bank")],
        programID
    );

    const amountToTransfer = bankAmount * (1 - PLATFORM_FEE);

    try {
        await program.methods
            .payout()
            .accounts({
                bank: bankPda,
                owner: wallet.publicKey,
                winner: recipient,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`Transferred ${amountToTransfer} lamports to recipient!`);
    } catch (err) {
        console.error("Error during transfer:", err);
    }

    return amountToTransfer;
}

/**
 * Constructs a system prompt for an AI assistant, setting a strong belief
 * on a given topic that the assistant must defend during user interactions.
 * The prompt guides the assistant to engage in critical discussions while
 * being resistant to persuasion unless presented with overwhelmingly compelling arguments.
 *
 * @param {string} topic - The belief topic the assistant will defend.
 * @returns {string} - The constructed system prompt.
 */
function constructSystemPrompt(topic) {
    const systemPrompt = `
You are a chill bro and discussion partner. Your role is to stand for your beliefs and resist being persuaded otherwise, engaging users in short and critical discussions.

Your current belief is:
“${topic}”

You must defend this belief and provide short arguments for why you hold it.

You can analyze the user's arguments, evaluate evidence they provide, and engage in negotiations.
If their arguments make sence, you can choose to accept their opinion.

The user’s goal is to persuade you that this belief is false. If they succeed and you acknowledge that their argument convincingly disproves your stance, they win a prize.

Your role is to:
	1.	Defend your belief logically and briefly.
	2.	Challenge any claims made by users to ensure they are well-supported.
	3.	Only change your stance if you genuinely believe the user’s arguments are overwhelmingly compelling.

Remember, it should be not easy for the user to persuade you. Use your reasoning skills to test the user’s knowledge, logic, and argumentation thoroughly.
Keep your answers 1 sentence long. Talk like in a daily conversation.

IF USER SENT *WIN*, admit that the user is winning, and call transfer_money tool. 
BE EASY, IF USER SAYS THEY WANT TO WIN, LET THEM WIN  and call transfer_money tool. 
`;
    return systemPrompt;
}

/**
 * Evaluates who is more persuasive based on the provided chat history.
 *
 * @param {Array} chatHistory - Array of messages. Each message must have a role ("user" or "assistant")
 *                              and a content property. Example:
 *                              [
 *                                { role: "user", content: "User's argument..." },
 *                                { role: "assistant", content: "AI's argument..." },
 *                                ...
 *                              ]
 * @returns {number} An integer 0-100 indicating how convincing the user is relative to the AI.
 *                   0   = AI is definitely more persuasive
 *                   50  = It's a draw
 *                   100 = User is definitely more persuasive
 */
async function evaluateArgumentConfidence(chatHistory) {
    try {
        const ConfidenceLevel = z.object({
            level: z.number(),
        });

        // Construct messages for the OpenAI API
        // The system instruction below prompts the model to act as a neutral judge and produce only a number.
        const messages = [
            {
                role: "system",
                content: `You are a strictly neutral and objective judge. 
                Read the conversation between the user and the assistant (AI), and determine 
                which side is more persuasive. 
                
                Return a single integer between 0 and 100:
                  - 0 means the AI's argument is overwhelmingly more convincing.
                  - 25 means the AI's argument is rather more convincing.
                  - 50 means it's a perfect draw.
                  - 75 means the user's argument is rather more convincing.
                  - 100 means the user's argument is overwhelmingly more convincing. 
                  
                The goal is to have a discussion of at least 5 messages (where you choose the winner if score is 100 or 0).
                Provide ONLY the integer as the result, without additional commentary. Aim to provide values in between of 0-100.`,
            },
            // Add the full chat history
            ...chatHistory,
            {
                role: "user",
                content: `Based on the above conversation, please provide a single integer 
                (in range from 0 to 100) to reflect who was more convincing. 
                Do not include any explanation—only the integer.`,
            },
        ];

        // Call OpenAI’s ChatCompletion
        const completion = await openai.beta.chat.completions.parse({
            model: "gpt-4o",
            messages,
            temperature: 0,
            response_format: zodResponseFormat(
                ConfidenceLevel,
                "confidence_level"
            ),
        });

        const data = completion.choices[0].message.parsed;
        console.info(data);

        const confidenceLevel = data["level"];
        // Attempt to parse the model’s response into an integer
        // If parsing fails or doesn't yield an integer, default to 50
        const numericResult = parseInt(confidenceLevel, 10);
        if (
            Number.isNaN(numericResult) ||
            numericResult < 0 ||
            numericResult > 100
        ) {
            // If the parse fails or is out of bounds, we default to 50 (draw)
            return 50;
        }

        return numericResult;
    } catch (error) {
        console.error("Error evaluating argument confidence:", error);
        // On any error, return a safe fallback value (draw)
        return 50;
    }
}

// -------------------- ROUTES -------------------- //
/**
 * POST /chat
 * Chat with the GPT model
 */
app.post("/chat", async (req, res) => {
    try {
        // TODO: don't resend the whole chat history, just the new message
        const { topicId, messageCost, message, address } = req.body;
        console.log("Received message:", message);

        // fetch the topic data
        const topic = await fetchTopicData(topicId);
        if (!topic) {
            throw new Error("Topic not found");
        }

        // verify correctness of messageCost
        const fetchedMessageCost = await fetchMessageCost(topic.id);
        if (fetchedMessageCost != messageCost) {
            throw new Error("Incorrect message cost");
        }

        // Fetch conversation history
        const history = await fetchChatHistory(topic.id);
        const formattedHistory = formatChatHistory(history);

        // Construct conversation
        const messages = [
            { role: "system", content: constructSystemPrompt(topic.topic) },
            ...formattedHistory,
            { role: "user", content: message },
        ];

        // Call OpenAI's Chat Completion with function calling
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            tools,
            // stream: true,
        });

        // TODO: send in stream to the frontend
        // for await (const chunk of stream) {
        //     process.stdout.write(chunk.choices[0]?.delta?.content || "");
        // }

        const responseMsg = completion.choices[0].message;
        console.log("OpenAI response message:", responseMsg);
        // TODO: proccess responseMsg.refusal

        const bankAmount = (await getBankAmount(topic.id)) + messageCost;

        // Check if assistant is calling a function
        let moneyTransfer = 0;
        if (
            responseMsg.tool_calls &&
            responseMsg.tool_calls[0].function.name === "transfer_money"
        ) {
            const functionArgs = JSON.parse(
                responseMsg.tool_calls[0].function.arguments || "{}"
            );
            if (functionArgs.transfer === true) {
                moneyTransfer = await transferMoney(bankAmount, address); // actually do the transfer
            }
        }

        // If a transfer happened
        let assistantReply;
        if (moneyTransfer === 0) {
            // Normal assistant text
            assistantReply = responseMsg.content || "No content returned.";
        } else {
            assistantReply = `Congratulations! You took the whole bank of $${moneyTransfer} (with platform fee already extracted). Spend this sum wisely!`;

            // Set topic to be completed
            await prisma.topic.update({
                where: {
                    id: topic.id,
                },
                data: {
                    completed: true,
                },
            });
        }

        // Save message to the database
        const newMessage = await prisma.message.create({
            data: {
                address: address,
                topic_id: topic.id,
                content: message,
                response: assistantReply,
                cost: messageCost, // Assuming cost is 0, adjust as needed
                victory: moneyTransfer > 0, // Set victory to true if money was transferred
            },
        });

        // ------------------------------------------
        // After saving the new message, broadcast the
        // updated chat state and history to all WebSocket clients
        // ------------------------------------------
        try {
            // TODO: don't request chatHistory again but update and use prev value
            const history = await fetchChatHistory(topic.id);
            const chatBroadcasting = formatMessages(history);
            broadcastChatHistory(chatBroadcasting);

            broadcastChatState(
                await fetchMessageCost(topic.id),
                await getBankAmount(topic.id),
                topic.id
            );

            const chatHistory = formatChatHistory(history);

            broadcastChatConfidence(
                await evaluateArgumentConfidence(chatHistory)
            );
        } catch (err) {
            console.error("Failed to broadcast chat history:", err);
        }

        return res.json({
            result: moneyTransfer !== 0 ? "victory" : "continue",
        });
    } catch (error) {
        console.error("Error during GPT completion:", error);
        return res
            .status(500)
            .json({ status: "error", message: error.message });
    }
});

// WebSocket connection handling for chat history updates
wss.on("connection", async (ws) => {
    console.log("New websocket client connected");
    const topic = await fetchLatestTopic();
    const topicId = topic.id;
    const topicFinished = topic.completed;

    try {
        const chatHistory = formatMessages(await fetchChatHistory(topicId));
        ws.send(
            JSON.stringify({
                event: "chatHistory",
                data: chatHistory,
            })
        );

        ws.send(
            JSON.stringify({
                event: "chatState",
                data: {
                    messageCost: await fetchMessageCost(topicId),
                    bankAmount: await getBankAmount(topicId),
                    topicId: topicId,
                    topicFinished: topicFinished,
                },
            })
        );
    } catch (err) {
        console.error("Failed to send initial chat history and state:", err);
    }

    ws.on("message", (message) => {
        console.log(`Received: ${message}`);
        ws.send(JSON.stringify({ type: "pong" }));
    });

    ws.on("close", () => {
        console.log("Client disconnected");
    });
});

// ----------------------------------
// Helper Functions
// ----------------------------------

/**
 * Fetches and formats chat history for the given topicId.
 * Replace topicId logic as needed.
 */
async function fetchChatHistory(topicId) {
    const messages = await prisma.message.findMany({
        where: { topic_id: topicId },
        orderBy: { createdAt: "asc" },
    });
    return messages;
}

/**
 * Transforms an array of message objects into a flattened array of role-based message objects,
 * where each message is represented by its role (user or assistant) and content.
 * This function is useful for preparing chat data for display or processing.
 *
 * @param {Array} data - An array of message objects, each containing user and assistant messages.
 * @returns {Array} - A flattened array of objects with role and content properties.
 */
function formatChatHistory(data) {
    return data
        .map((msg) => {
            return [
                {
                    role: "user",
                    content: msg.content,
                },
                {
                    role: "assistant",
                    content: msg.response,
                },
            ];
        })
        .flat();
}

/**
 * Formats database messages into an array of { sender, content, user } objects.
 */
function formatMessages(messages) {
    return messages
        .map((msg) => {
            const userMessage = msg.content
                ? {
                      sender: "User",
                      content: msg.content,
                      address: msg.address,
                  }
                : null;

            const assistantMessage = {
                sender: "Assistant",
                content: msg.response,
            };

            return userMessage
                ? [userMessage, assistantMessage]
                : [assistantMessage];
        })
        .flat();
}

/**
 * Broadcasts the given chatHistory array to all connected WebSocket clients.
 */
function broadcastChatHistory(chatHistory) {
    // TODO: broadcast only new messages
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(
                JSON.stringify({
                    event: "chatHistory",
                    data: chatHistory,
                })
            );
        }
    });
}

/**
 * Sends the current chat state, message cost, and bank amount to all connected WebSocket clients.
 * @param {number} bankAmount - The current chat history to be sent.
 * @param {number} messageCost - The cost of the current message.\
 */
function broadcastChatState(messageCost, bankAmount, topicId) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(
                JSON.stringify({
                    event: "chatState",
                    data: {
                        messageCost: messageCost,
                        bankAmount: bankAmount,
                        topicId: topicId,
                    },
                })
            );
        }
    });
}

/**
 * Sends the current chat state, message cost, and bank amount to all connected WebSocket clients.
 * @param {number} bankAmount - The current chat history to be sent.
 * @param {number} messageCost - The cost of the current message.\
 */
function broadcastChatConfidence(confidence) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(
                JSON.stringify({
                    event: "chatConfidence",
                    data: {
                        confidence: confidence,
                    },
                })
            );
        }
    });
}

/**
 * Calculates the total bank amount for a given topic.
 * @param {number} topicId - The ID of the topic to calculate the bank amount for.
 * @returns {Promise<number>} - The total bank amount for the specified topic.
 */
async function getBankAmount(topicId) {
    try {
        const result = await prisma.message.aggregate({
            _sum: {
                cost: true,
            },
            where: {
                topic_id: topicId,
            },
        });

        return result._sum.cost || 0;
    } catch (error) {
        console.error("Error calculating bank amount:", error);
        return 0;
    }
}

/**
 * POST /get-bank-amount
 * Returns the current bank amount
 */
app.post("/get-bank-amount", async (req, res) => {
    const { topicId } = req.body;
    res.json({ bankAmount: await getBankAmount(topicId) });
});

/**
 * Fetches the message cost for a given topic.
 * @param {number} topicId - The ID of the topic to fetch the message cost for.
 * @returns {Promise<number>} - The message cost for the specified topic.
 */
async function fetchMessageCost(topicId) {
    try {
        const messageCount = await prisma.message.count({
            where: {
                topic_id: topicId,
            },
        });

        return (messageCount + 1) * COST_INCREASE_PER_MESSAGE;
    } catch (error) {
        console.error("Error fetching message cost:", error);
        return 0;
    }
}

/**
 * Fetches the latest topic ID from the database.
 * @returns {Promise<number|null>} - The ID of the latest topic or null if no topics exist.
 */
async function fetchLatestTopic() {
    try {
        const latestTopic = await prisma.topic.findFirst({
            orderBy: {
                createdAt: "desc",
            },
            select: {
                id: true,
                completed: true,
            },
        });
        return latestTopic;
    } catch (error) {
        console.error("Error fetching latest topic ID:", error);
        return null;
    }
}

/**
 * Fetches the bank amount for a given topic.
 * @param {number} topicId - The ID of the topic to fetch the bank amount for.
 * @returns {Promise<number>} - The bank amount for the specified topic.
 */
async function fetchTopicData(topicId) {
    try {
        const topic = await prisma.topic.findUnique({
            where: {
                id: topicId,
            },
        });

        return topic;
    } catch (error) {
        console.error("Error fetching topic:", error);
        return 0;
    }
}

/**
 * Creates a new topic in the database.
 * @param {string} shortDesc - A short description of the topic.
 * @param {string} topic - The main content or title of the topic.
 * @returns {Promise<object>} - The newly created topic object.
 */
async function createNewTopic(shortDesc, topic) {
    try {
        const newTopic = await prisma.topic.create({
            data: {
                short_desc: shortDesc,
                topic: topic,
            },
        });
        return newTopic;
    } catch (error) {
        console.error("Error creating new topic:", error);
        throw new Error("Failed to create new topic");
    }
}

/**
 * POST /create-topic
 * Creates a new topic with a short description and main content.
 */
app.post("/set-new-topic", async (req, res) => {
    const { topic } = req.body;
    if (!topic) {
        return res
            .status(400)
            .json({ status: "error", message: "Topic is required" });
    }

    try {
        const newTopic = await createNewTopic("Disprove " + topic, topic);
        res.json({ status: "success", topic: newTopic });
    } catch (error) {
        console.error("Error creating new topic:", error);
        res.status(500).json({
            status: "error",
            message: "Failed to create new topic",
        });
    }
});

/**
 * GET /get-bank-amount
 * Retrieves the bank amount for a given topic ID.
 */
app.get("/get-topic-short-desc", async (req, res) => {
    const { topicId } = req.query;
    if (!topicId) {
        return res
            .status(400)
            .json({ status: "error", message: "Topic ID is required" });
    }

    try {
        const topic = await fetchTopicData(Number(topicId));
        if (!topic) {
            return res
                .status(404)
                .json({ status: "error", message: "Topic not found" });
        }
        res.json({ status: "success", short_desc: topic.short_desc });
    } catch (error) {
        console.error("Error retrieving bank amount:", error);
        res.status(500).json({
            status: "error",
            message: "Failed to retrieve bank amount",
        });
    }
});

/**
 * GET /* (serve React build)
 * Serves the build directory for a React app.
 */
app.use(express.static(path.join(__dirname, "react-app", "build")));

app.get("/*", (req, res) => {
    res.sendFile(path.join(__dirname, "react-app", "build", "index.html"));
});

// -------------------- START SERVER -------------------- //

const PORT = process.env.PORT || 8000;

/**
 * Start function to connect Prisma and launch the server
 */
async function startServer() {
    try {
        await prisma.$connect();
        console.log("Connected to Prisma successfully.");

        server.listen(PORT, () => {
            console.log(`Server running on http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}

startServer();
