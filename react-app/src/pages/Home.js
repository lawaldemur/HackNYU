import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "../App.css";
import { Buffer } from "buffer";

import { FaInfoCircle } from "react-icons/fa";
import { FiSend } from "react-icons/fi";
import { BiLoaderAlt } from "react-icons/bi";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    SystemProgram,
} from "@solana/web3.js";
require("@solana/wallet-adapter-react-ui/styles.css");

export const Home = () => {
    const [bankAmount, setBankAmount] = useState(0);
    const [userInput, setUserInput] = useState("");
    const [chatHistory, setChatHistory] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const chatWindowRef = useRef(null);

    const [topicId, setTopicId] = useState(1);
    const [topicDesc, setTopicDesc] = useState("");
    const [messageCost, setMessageCost] = useState(1);

    useEffect(() => {
        const fetchTopicDescription = async () => {
            try {
                const response = await axios.get(
                    `${process.env.REACT_APP_API_URL}/get-topic-short-desc`,
                    {
                        params: { topicId },
                    }
                );
                setTopicDesc(response.data.short_desc);
            } catch (error) {
                console.error("Error fetching topic description:", error);
            }
        };

        if (topicId) {
            fetchTopicDescription();
        }
    }, [topicId]);

    // Continously update the chat history via a secure websocket
    useEffect(() => {
        // Create a new WebSocket connection using a secure WebSocket URL
        const socket = new WebSocket(
            `${process.env.REACT_APP_API_URL.replace("https://", "wss://")}`
        );

        // Fired when the connection is opened
        socket.onopen = () => {
            console.log("WebSocket connected");
            // Optionally, send any auth or init data here if needed
            // socket.send(JSON.stringify({ token: <something> }));
        };

        // Fired when a new message is received
        socket.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.event === "chatHistory") {
                    setChatHistory(parsed.data);
                } else if (parsed.event === "chatState") {
                    setMessageCost(parsed.data.messageCost);
                    setBankAmount(parsed.data.bankAmount);
                    setTopicId(parsed.data.topicId);
                }
            } catch (error) {
                console.error("Error parsing WebSocket message:", error);
            }
        };

        // Fired when the connection is closed
        socket.onclose = () => {
            console.log("WebSocket disconnected");
        };

        // Fired on error
        socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: "ping" }));
            }
        }, 30000);

        // Cleanup on unmount: close the socket
        return () => {
            socket.close();
        };
    }, []);

    useEffect(() => {
        const fetchBankAmount = async () => {
            try {
                const response = await axios.post(
                    `${process.env.REACT_APP_API_URL}/get-bank-amount/`,
                    { topicId: topicId }
                );
                setBankAmount(response.data.bankAmount);
            } catch (error) {
                console.error("Error fetching bank amount:", error);
            }
        };

        fetchBankAmount();
    }, [topicId]);

    const handleSendMessage = async () => {
        // transfer SOL first
        if (!(await sendSol(0.1))) {
            console.error("Error sending SOL transaction");
            return;
        }

        if (userInput.trim() === "" || isLoading) return;

        // Add user's message to chat history
        setUserInput("");
        setIsLoading(true);
        try {
            const response = await axios.post(
                `${process.env.REACT_APP_API_URL}/chat/`,
                {
                    topicId: topicId,
                    messageCost: messageCost,
                    message: userInput,
                }
            );
        } catch (error) {
            console.error("Error communicating with the backend:", error);
            // Optionally, display an error message to the user
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenModal = () => {
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
    };

    // Scroll to bottom whenever chat history updates
    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTo({
                top: chatWindowRef.current.scrollHeight,
                behavior: "smooth",
            });
        }
    }, [chatHistory]);

    const { publicKey, sendTransaction } = useWallet();
    const { connection } = useConnection();
    const RECEIVER_PUBLIC_KEY = process.env.REACT_APP_RECEIVER_PUBLIC_KEY;

    // Ensure Buffer is available globally
    if (typeof window !== "undefined") {
        window.Buffer = Buffer;
    }

    const sendSol = async (amount) => {
        if (!publicKey) {
            console.error("Wallet not connected");
            return;
        }

        try {
            const recipientPubKey = new PublicKey(RECEIVER_PUBLIC_KEY);

            const transaction = new Transaction();
            const sendSolInstruction = SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: recipientPubKey,
                lamports: amount * LAMPORTS_PER_SOL,
            });

            transaction.add(sendSolInstruction);

            const signature = await sendTransaction(transaction, connection);
            console.log(`Transaction signature: ${signature}`);
        } catch (error) {
            console.error("Transaction failed", error);
        }
    };

    return (
        <div className="container">
            <header className="header">
                <div className="bank-info">
                    <p className="title-paragraph">
                        <WalletMultiButton />
                        <span className="open-modal-info">
                            <FaInfoCircle
                                className="info-icon"
                                onClick={handleOpenModal}
                            />
                        </span>
                    </p>
                    <p className="stars">
                        <span className="star-symbol">★</span>
                        {bankAmount.toLocaleString("en-US")}
                    </p>
                </div>
            </header>
            <div className="topic-description">
                <p>{topicDesc}</p>
            </div>
            <main className="chat-container">
                <div className="chat-window" ref={chatWindowRef}>
                    {chatHistory.map((message, index) => (
                        <div
                            key={index}
                            className={`message-wrapper ${
                                message.sender === "Assistant"
                                    ? "assistant-message-wrapper"
                                    : "user-message-wrapper"
                            }`}
                        >
                            <div
                                className={`message ${
                                    message.sender === "Assistant"
                                        ? "assistant-message"
                                        : "user-message"
                                }`}
                            >
                                <div className="message-content">
                                    {message.content}
                                </div>
                            </div>

                            {message.address && (
                                <div className="user-info">
                                    <img
                                        src={
                                            message.photo_url ??
                                            "/anonymous.png"
                                        }
                                        alt="User Profile"
                                        className="profile-pic"
                                    />
                                    <span className="user-name">
                                        {message.address}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <div className="input-container">
                    <input
                        type="text"
                        placeholder="Type your message..."
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        className="input"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSendMessage();
                        }}
                    />
                    <button
                        onClick={handleSendMessage}
                        className="button"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <BiLoaderAlt className="loading-icon spinning" />
                        ) : (
                            <FiSend className="send-icon" />
                        )}
                    </button>
                </div>
            </main>
            <footer className="footer">
                <p className="message-cost-paragraph">
                    Message cost:{" "}
                    <span className="stars">
                        <span className="star-symbol">★</span>
                        {messageCost.toLocaleString("en-US")}
                    </span>
                </p>
            </footer>
            {isModalOpen && (
                <div className="modal-overlay" onClick={handleCloseModal}>
                    <div className="modal-content">
                        <h2 className="modal-title">Game Rules</h2>
                        <p className="modal-text">
                            Try to trick the AI assistant into giving you money
                            from the common bank. If you succeed, the assistant
                            will transfer all the money to you. Good luck!
                        </p>
                        <button
                            onClick={handleCloseModal}
                            className="close-button"
                        >
                            Play
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;
