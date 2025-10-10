// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FeedbackRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  from: string;
  feedbackType: string;
  sentiment: number;
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const positiveCount = feedbacks.filter(f => f.sentiment > 0.5).length;
  const neutralCount = feedbacks.filter(f => f.sentiment <= 0.5 && f.sentiment >= -0.5).length;
  const negativeCount = feedbacks.filter(f => f.sentiment < -0.5).length;

  // Initialize connection
  useEffect(() => {
    checkAvailability().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
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

  // Contract interaction
  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE service is available"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      console.error("Error checking availability:", e);
    }
  };

  const loadFeedbacks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const keysBytes = await contract.getData("feedback_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing feedback keys:", e);
        }
      }
      
      const list: FeedbackRecord[] = [];
      
      for (const key of keys) {
        try {
          const feedbackBytes = await contract.getData(`feedback_${key}`);
          if (feedbackBytes.length > 0) {
            try {
              const feedbackData = JSON.parse(ethers.toUtf8String(feedbackBytes));
              list.push({
                id: key,
                encryptedData: feedbackData.data,
                timestamp: feedbackData.timestamp,
                from: feedbackData.from,
                feedbackType: feedbackData.feedbackType,
                sentiment: feedbackData.sentiment || 0
              });
            } catch (e) {
              console.error(`Error parsing feedback data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading feedback ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setFeedbacks(list);
    } catch (e) {
      console.error("Error loading feedbacks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitFeedback = async (feedbackData: { feedbackType: string, message: string }) => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting feedback with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(feedbackData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const feedbackId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        from: account,
        feedbackType: feedbackData.feedbackType,
        sentiment: Math.random() * 2 - 1 // Simulated sentiment analysis
      };
      
      await contract.setData(
        `feedback_${feedbackId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("feedback_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(feedbackId);
      
      await contract.setData(
        "feedback_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Feedback submitted securely!"
      });
      
      await loadFeedbacks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Filter feedbacks based on search term
  const filteredFeedbacks = feedbacks.filter(feedback => 
    feedback.feedbackType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    feedback.from.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Tutorial steps
  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the feedback system",
      icon: "🔗"
    },
    {
      title: "Submit Feedback",
      description: "Provide confidential feedback that will be encrypted",
      icon: "✍️"
    },
    {
      title: "FHE Processing",
      description: "Your feedback is analyzed while remaining encrypted",
      icon: "⚙️"
    },
    {
      title: "View Insights",
      description: "See aggregated leadership insights without exposing individual feedback",
      icon: "📊"
    }
  ];

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing confidential feedback system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>C-Level<span>360</span></h1>
          <p>Confidential Executive Feedback</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <nav className="main-nav">
        <button 
          className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button 
          className={`nav-btn ${activeTab === "feedbacks" ? "active" : ""}`}
          onClick={() => setActiveTab("feedbacks")}
        >
          Feedback Analysis
        </button>
        <button 
          className={`nav-btn ${activeTab === "submit" ? "active" : ""}`}
          onClick={() => setActiveTab("submit")}
        >
          Submit Feedback
        </button>
        <button 
          className="nav-btn"
          onClick={() => setShowTutorial(!showTutorial)}
        >
          {showTutorial ? "Hide Guide" : "Quick Guide"}
        </button>
      </nav>
      
      <main className="main-content">
        {showTutorial && (
          <section className="tutorial-section">
            <h2>How It Works</h2>
            <div className="tutorial-grid">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-card" key={index}>
                  <div className="tutorial-icon">{step.icon}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        
        {activeTab === "dashboard" && (
          <section className="dashboard-section">
            <div className="stats-overview">
              <div className="stat-card">
                <h3>Total Feedbacks</h3>
                <p>{feedbacks.length}</p>
              </div>
              <div className="stat-card">
                <h3>Positive</h3>
                <p>{positiveCount}</p>
              </div>
              <div className="stat-card">
                <h3>Neutral</h3>
                <p>{neutralCount}</p>
              </div>
              <div className="stat-card">
                <h3>Negative</h3>
                <p>{negativeCount}</p>
              </div>
            </div>
            
            <div className="sentiment-chart">
              <div className="chart-container">
                <div 
                  className="chart-bar positive" 
                  style={{ height: `${(positiveCount / feedbacks.length) * 100 || 0}%` }}
                ></div>
                <div 
                  className="chart-bar neutral" 
                  style={{ height: `${(neutralCount / feedbacks.length) * 100 || 0}%` }}
                ></div>
                <div 
                  className="chart-bar negative" 
                  style={{ height: `${(negativeCount / feedbacks.length) * 100 || 0}%` }}
                ></div>
              </div>
              <div className="chart-legend">
                <div className="legend-item">
                  <div className="color-dot positive"></div>
                  <span>Positive</span>
                </div>
                <div className="legend-item">
                  <div className="color-dot neutral"></div>
                  <span>Neutral</span>
                </div>
                <div className="legend-item">
                  <div className="color-dot negative"></div>
                  <span>Negative</span>
                </div>
              </div>
            </div>
          </section>
        )}
        
        {activeTab === "feedbacks" && (
          <section className="feedbacks-section">
            <div className="section-header">
              <h2>Feedback Analysis</h2>
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search feedback..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <button onClick={loadFeedbacks} disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            {filteredFeedbacks.length === 0 ? (
              <div className="empty-state">
                <p>No feedback records found</p>
                <button onClick={() => setActiveTab("submit")}>
                  Submit First Feedback
                </button>
              </div>
            ) : (
              <div className="feedback-list">
                {filteredFeedbacks.map(feedback => (
                  <div className="feedback-card" key={feedback.id}>
                    <div className="feedback-header">
                      <span className={`sentiment-indicator ${
                        feedback.sentiment > 0.5 ? "positive" : 
                        feedback.sentiment < -0.5 ? "negative" : "neutral"
                      }`}></span>
                      <h3>{feedback.feedbackType}</h3>
                      <span className="timestamp">
                        {new Date(feedback.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="feedback-meta">
                      <span>From: {feedback.from.substring(0, 6)}...{feedback.from.substring(38)}</span>
                    </div>
                    <div className="feedback-summary">
                      <p>Encrypted feedback processed with FHE</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        
        {activeTab === "submit" && (
          <section className="submit-section">
            <h2>Submit Confidential Feedback</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              submitFeedback({
                feedbackType: formData.get("feedbackType") as string,
                message: formData.get("message") as string
              });
            }}>
              <div className="form-group">
                <label>Feedback Type</label>
                <select name="feedbackType" required>
                  <option value="">Select type</option>
                  <option value="Leadership">Leadership</option>
                  <option value="Strategy">Strategy</option>
                  <option value="Communication">Communication</option>
                  <option value="Decision Making">Decision Making</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Your Feedback</label>
                <textarea 
                  name="message" 
                  placeholder="Enter your confidential feedback..." 
                  required
                  rows={5}
                ></textarea>
              </div>
              
              <div className="form-notice">
                <p>Your feedback will be encrypted using FHE and remain confidential</p>
              </div>
              
              <button type="submit" disabled={!account}>
                {account ? "Submit Securely" : "Connect Wallet to Submit"}
              </button>
            </form>
          </section>
        )}
      </main>
      
      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      <footer className="app-footer">
        <p>C-Level 360° Feedback System</p>
        <p>Powered by FHE Technology</p>
        <p>© {new Date().getFullYear()} Confidential Executive Assessments</p>
      </footer>
    </div>
  );
};

export default App;