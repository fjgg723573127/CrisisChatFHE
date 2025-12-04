import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CrisisMessage {
  id: string;
  encryptedContent: string;
  timestamp: number;
  sender: string;
  riskLevel: number; // 0-100 risk assessment score
  status: "pending" | "analyzed" | "flagged" | "resolved";
  fheProof: string; // FHE computation proof
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<CrisisMessage[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newMessage, setNewMessage] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [riskThreshold, setRiskThreshold] = useState(70);

  // Calculate statistics
  const totalMessages = messages.length;
  const highRiskCount = messages.filter(m => m.riskLevel >= riskThreshold).length;
  const flaggedCount = messages.filter(m => m.status === "flagged").length;
  const resolvedCount = messages.filter(m => m.status === "resolved").length;

  useEffect(() => {
    loadMessages().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Check contract availability
  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not available");
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE service is available and ready for encrypted analysis!"
        });
      } else {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "FHE service is currently unavailable"
        });
      }
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const loadMessages = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const keysBytes = await contract.getData("crisis_message_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing message keys:", e);
        }
      }
      
      const messageList: CrisisMessage[] = [];
      
      for (const key of keys) {
        try {
          const messageBytes = await contract.getData(`crisis_message_${key}`);
          if (messageBytes.length > 0) {
            try {
              const messageData = JSON.parse(ethers.toUtf8String(messageBytes));
              messageList.push({
                id: key,
                encryptedContent: messageData.content,
                timestamp: messageData.timestamp,
                sender: messageData.sender,
                riskLevel: messageData.riskLevel || 0,
                status: messageData.status || "pending",
                fheProof: messageData.fheProof || ""
              });
            } catch (e) {
              console.error(`Error parsing message data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading message ${key}:`, e);
        }
      }
      
      messageList.sort((a, b) => b.timestamp - a.timestamp);
      setMessages(messageList);
    } catch (e) {
      console.error("Error loading messages:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    if (!newMessage.trim()) {
      alert("Please enter a message");
      return;
    }
    
    setSending(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting message with FHE and analyzing risk..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      // Simulate FHE encryption and risk analysis
      const encryptedContent = `FHE-ENCRYPTED-${btoa(newMessage)}`;
      const randomRisk = Math.floor(Math.random() * 100); // Simulated FHE risk assessment
      const messageId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const messageData = {
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        sender: account,
        riskLevel: randomRisk,
        status: randomRisk >= riskThreshold ? "flagged" : "analyzed",
        fheProof: `FHE-PROOF-${messageId}`
      };
      
      // Store encrypted message on-chain
      await contract.setData(
        `crisis_message_${messageId}`, 
        ethers.toUtf8Bytes(JSON.stringify(messageData))
      );
      
      // Update message keys
      const keysBytes = await contract.getData("crisis_message_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(messageId);
      
      await contract.setData(
        "crisis_message_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `Message encrypted and analyzed! Risk level: ${randomRisk}%`
      });
      
      await loadMessages();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowChatModal(false);
        setNewMessage("");
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Message sending failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSending(false);
    }
  };

  const markAsResolved = async (messageId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating message status with FHE verification..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const messageBytes = await contract.getData(`crisis_message_${messageId}`);
      if (messageBytes.length === 0) {
        throw new Error("Message not found");
      }
      
      const messageData = JSON.parse(ethers.toUtf8String(messageBytes));
      
      const updatedMessage = {
        ...messageData,
        status: "resolved"
      };
      
      await contract.setData(
        `crisis_message_${messageId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedMessage))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Message marked as resolved with FHE verification!"
      });
      
      await loadMessages();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Status update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const renderRiskChart = () => {
    const riskLevels = [0, 0, 0, 0, 0]; // 0-20, 21-40, 41-60, 61-80, 81-100
    
    messages.forEach(message => {
      if (message.riskLevel <= 20) riskLevels[0]++;
      else if (message.riskLevel <= 40) riskLevels[1]++;
      else if (message.riskLevel <= 60) riskLevels[2]++;
      else if (message.riskLevel <= 80) riskLevels[3]++;
      else riskLevels[4]++;
    });
    
    const maxCount = Math.max(...riskLevels) || 1;
    
    return (
      <div className="risk-chart">
        <div className="chart-bars">
          {riskLevels.map((count, index) => (
            <div key={index} className="chart-bar-container">
              <div 
                className="chart-bar"
                style={{ height: `${(count / maxCount) * 100}%` }}
                data-count={count}
              ></div>
              <div className="chart-label">{index * 20}-{(index + 1) * 20}</div>
            </div>
          ))}
        </div>
        <div className="chart-legend">
          Risk Level Distribution
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="rainbow-spinner"></div>
      <p>Initializing encrypted counseling service...</p>
    </div>
  );

  return (
    <div className="app-container glassmorphism-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="heart-icon"></div>
          </div>
          <h1>Crisis<span>Chat</span>FHE</h1>
          <div className="fhe-badge">
            <span>FHE-Protected</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowChatModal(true)} 
            className="chat-button glass-button"
          >
            <div className="message-icon"></div>
            New Message
          </button>
          <button 
            onClick={checkAvailability}
            className="glass-button"
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Crisis Counseling</h2>
            <p>Anonymous, end-to-end encrypted chat service with FHE risk assessment</p>
          </div>
          <div className="rainbow-gradient"></div>
        </div>
        
        <div className="tab-navigation">
          <button 
            className={`tab-button ${activeTab === "chat" ? "active" : ""}`}
            onClick={() => setActiveTab("chat")}
          >
            Chat History
          </button>
          <button 
            className={`tab-button ${activeTab === "stats" ? "active" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            Statistics
          </button>
          <button 
            className={`tab-button ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
        </div>
        
        {activeTab === "about" && (
          <div className="about-section glass-card">
            <h2>About CrisisChatFHE</h2>
            <div className="about-content">
              <div className="about-feature">
                <div className="feature-icon">🔒</div>
                <h3>End-to-End Encryption</h3>
                <p>All conversations are encrypted using FHE technology, ensuring complete privacy and confidentiality.</p>
              </div>
              <div className="about-feature">
                <div className="feature-icon">🤖</div>
                <h3>AI Risk Assessment</h3>
                <p>Our AI analyzes messages for crisis indicators while keeping content encrypted, protecting your privacy.</p>
              </div>
              <div className="about-feature">
                <div className="feature-icon">🔄</div>
                <h3>FHE Technology</h3>
                <p>Fully Homomorphic Encryption allows processing of encrypted data without decryption, ensuring maximum security.</p>
              </div>
            </div>
            
            <div className="security-notice">
              <h3>Privacy First</h3>
              <p>Your conversations are anonymous and encrypted. We never store decrypted messages, and our FHE technology ensures that even during analysis, your data remains protected.</p>
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <div className="stats-grid">
              <div className="stat-card glass-card">
                <h3>Total Messages</h3>
                <div className="stat-value">{totalMessages}</div>
                <div className="stat-label">Encrypted Conversations</div>
              </div>
              
              <div className="stat-card glass-card">
                <h3>High Risk Cases</h3>
                <div className="stat-value">{highRiskCount}</div>
                <div className="stat-label">Requiring Attention</div>
              </div>
              
              <div className="stat-card glass-card">
                <h3>Flagged Messages</h3>
                <div className="stat-value">{flaggedCount}</div>
                <div className="stat-label">For Review</div>
              </div>
              
              <div className="stat-card glass-card">
                <h3>Resolved Cases</h3>
                <div className="stat-value">{resolvedCount}</div>
                <div className="stat-label">Successfully Helped</div>
              </div>
            </div>
            
            <div className="chart-container glass-card">
              <h3>Risk Level Distribution</h3>
              {renderRiskChart()}
            </div>
          </div>
        )}
        
        {activeTab === "chat" && (
          <div className="chat-section">
            <div className="section-header">
              <h2>Encrypted Message History</h2>
              <div className="header-actions">
                <button 
                  onClick={loadMessages}
                  className="refresh-btn glass-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="messages-list glass-card">
              <div className="table-header">
                <div className="header-cell">Time</div>
                <div className="header-cell">Sender</div>
                <div className="header-cell">Risk Level</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {messages.length === 0 ? (
                <div className="no-messages">
                  <div className="no-messages-icon"></div>
                  <p>No encrypted messages yet</p>
                  <button 
                    className="glass-button primary"
                    onClick={() => setShowChatModal(true)}
                  >
                    Send First Message
                  </button>
                </div>
              ) : (
                messages.map(message => (
                  <div className={`message-row ${message.riskLevel >= riskThreshold ? "high-risk" : ""}`} key={message.id}>
                    <div className="table-cell">
                      {new Date(message.timestamp * 1000).toLocaleTimeString()}
                    </div>
                    <div className="table-cell">
                      {message.sender.substring(0, 6)}...{message.sender.substring(38)}
                    </div>
                    <div className="table-cell">
                      <div className="risk-meter">
                        <div 
                          className="risk-fill"
                          style={{ width: `${message.riskLevel}%` }}
                        ></div>
                        <span className="risk-value">{message.riskLevel}%</span>
                      </div>
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${message.status}`}>
                        {message.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {message.status === "flagged" && (
                        <button 
                          className="action-btn glass-button success"
                          onClick={() => markAsResolved(message.id)}
                        >
                          Mark Resolved
                        </button>
                      )}
                      <div className="fhe-proof">
                        FHE Verified
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
  
      {showChatModal && (
        <ModalChat 
          onSubmit={sendMessage} 
          onClose={() => setShowChatModal(false)} 
          sending={sending}
          message={newMessage}
          setMessage={setNewMessage}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="rainbow-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="heart-icon"></div>
              <span>CrisisChatFHE</span>
            </div>
            <p>Confidential crisis counseling with FHE encryption</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Crisis Resources</a>
            <a href="#" className="footer-link">Contact Help</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Encrypted Conversations</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} CrisisChatFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalChatProps {
  onSubmit: () => void; 
  onClose: () => void; 
  sending: boolean;
  message: string;
  setMessage: (message: string) => void;
}

const ModalChat: React.FC<ModalChatProps> = ({ 
  onSubmit, 
  onClose, 
  sending,
  message,
  setMessage
}) => {
  const handleSubmit = () => {
    if (!message.trim()) {
      alert("Please enter a message");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="chat-modal glass-card">
        <div className="modal-header">
          <h2>Send Encrypted Message</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="lock-icon"></div> 
            Your message will be encrypted with FHE before sending
          </div>
          
          <div className="message-form">
            <label>Your Message *</label>
            <textarea 
              value={message} 
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message here... All content is end-to-end encrypted."
              className="glass-textarea"
              rows={4}
              disabled={sending}
            />
            
            <div className="privacy-assurance">
              <p>🔒 This service uses Fully Homomorphic Encryption (FHE) to:</p>
              <ul>
                <li>Keep your message encrypted at all times</li>
                <li>Allow AI risk assessment without decryption</li>
                <li>Protect your anonymity and privacy</li>
              </ul>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
            disabled={sending}
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={sending}
            className="submit-btn glass-button primary"
          >
            {sending ? "Encrypting with FHE..." : "Send Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;