// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ExecutiveFeedbackSystem is SepoliaConfig {
    // Feedback category structure
    struct FeedbackCategory {
        euint32 encryptedScore;        // Encrypted score for category
        euint32 encryptedWeight;       // Encrypted weight for category
    }
    
    // Encrypted feedback structure
    struct EncryptedFeedback {
        address executive;             // Executive being evaluated
        address reviewer;              // Reviewer address
        FeedbackCategory[5] categories; // Encrypted category scores (e.g., leadership, strategy)
        euint32 encryptedComments;      // Encrypted comments (optional)
        uint256 timestamp;              // Submission time
    }
    
    // Aggregated report structure
    struct LeadershipReport {
        euint32[5] encryptedAvgScores;  // Encrypted average scores per category
        euint32 encryptedOverallScore;  // Encrypted overall score
        bool isAggregated;               // Aggregation status
    }
    
    // Contract state
    uint256 public feedbackCount;
    mapping(uint256 => EncryptedFeedback) public feedbacks;
    mapping(address => LeadershipReport) public reports;
    mapping(address => bool) public isExecutive;
    mapping(address => bool) public isReviewer;
    
    // Feedback parameters
    uint256 public constant MIN_REVIEWERS = 5;
    uint256 public feedbackPeriod = 30 days;
    
    // Events
    event FeedbackSubmitted(uint256 indexed id, address indexed executive);
    event AggregationRequested(address indexed executive);
    event ReportGenerated(address indexed executive);
    event ReportDecrypted(address indexed executive);
    
    // Only registered executives
    modifier onlyExecutive() {
        require(isExecutive[msg.sender], "Not executive");
        _;
    }
    
    // Only approved reviewers
    modifier onlyReviewer() {
        require(isReviewer[msg.sender], "Not reviewer");
        _;
    }
    
    /// @notice Register executive participant
    function registerExecutive() public {
        isExecutive[msg.sender] = true;
    }
    
    /// @notice Approve reviewer
    function approveReviewer(address reviewer) public {
        isReviewer[reviewer] = true;
    }
    
    /// @notice Submit encrypted feedback
    function submitFeedback(
        address executive,
        euint32[5] memory encryptedScores,
        euint32[5] memory encryptedWeights,
        euint32 encryptedComments
    ) public onlyReviewer {
        require(isExecutive[executive], "Invalid executive");
        
        uint256 newId = ++feedbackCount;
        
        // Initialize categories
        FeedbackCategory[5] memory categories;
        for (uint i = 0; i < 5; i++) {
            categories[i] = FeedbackCategory({
                encryptedScore: encryptedScores[i],
                encryptedWeight: encryptedWeights[i]
            });
        }
        
        feedbacks[newId] = EncryptedFeedback({
            executive: executive,
            reviewer: msg.sender,
            categories: categories,
            encryptedComments: encryptedComments,
            timestamp: block.timestamp
        });
        
        emit FeedbackSubmitted(newId, executive);
    }
    
    /// @notice Request feedback aggregation
    function requestAggregation() public onlyExecutive {
        require(!reports[msg.sender].isAggregated, "Already aggregated");
        
        // Prepare encrypted data for aggregation
        uint256 feedbackCountForExec = 0;
        for (uint i = 1; i <= feedbackCount; i++) {
            if (feedbacks[i].executive == msg.sender) {
                feedbackCountForExec++;
            }
        }
        
        require(feedbackCountForExec >= MIN_REVIEWERS, "Insufficient feedback");
        
        bytes32[] memory ciphertexts = new bytes32[](feedbackCountForExec * 11);
        uint256 index = 0;
        
        // Collect all feedback data for this executive
        for (uint i = 1; i <= feedbackCount; i++) {
            if (feedbacks[i].executive == msg.sender) {
                for (uint j = 0; j < 5; j++) {
                    ciphertexts[index++] = FHE.toBytes32(feedbacks[i].categories[j].encryptedScore);
                    ciphertexts[index++] = FHE.toBytes32(feedbacks[i].categories[j].encryptedWeight);
                }
                ciphertexts[index++] = FHE.toBytes32(feedbacks[i].encryptedComments);
            }
        }
        
        // Request aggregation
        uint256 reqId = FHE.requestComputation(ciphertexts, this.aggregateFeedback.selector);
        
        emit AggregationRequested(msg.sender);
    }
    
    /// @notice Callback for feedback aggregation
    function aggregateFeedback(
        uint256 requestId,
        bytes memory results,
        bytes memory proof
    ) public {
        // Verify computation proof
        FHE.checkSignatures(requestId, results, proof);
        
        // Process aggregation results
        uint32[5] memory avgScores;
        uint32 overallScore;
        (avgScores, overallScore) = abi.decode(results, (uint32[5], uint32));
        
        address executive = msg.sender;
        
        // Store encrypted results
        euint32[5] memory encryptedAvgs;
        for (uint i = 0; i < 5; i++) {
            encryptedAvgs[i] = FHE.asEuint32(avgScores[i]);
        }
        
        reports[executive] = LeadershipReport({
            encryptedAvgScores: encryptedAvgs,
            encryptedOverallScore: FHE.asEuint32(overallScore),
            isAggregated: true
        });
        
        emit ReportGenerated(executive);
    }
    
    /// @notice Request report decryption
    function requestReportDecryption() public onlyExecutive {
        require(reports[msg.sender].isAggregated, "Report not ready");
        
        // Prepare encrypted report for decryption
        bytes32[] memory ciphertexts = new bytes32[](6);
        LeadershipReport storage report = reports[msg.sender];
        
        for (uint i = 0; i < 5; i++) {
            ciphertexts[i] = FHE.toBytes32(report.encryptedAvgScores[i]);
        }
        ciphertexts[5] = FHE.toBytes32(report.encryptedOverallScore);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptReport.selector);
    }
    
    /// @notice Callback for decrypted report
    function decryptReport(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted report
        uint32[5] memory avgScores;
        uint32 overallScore;
        (avgScores, overallScore) = abi.decode(cleartexts, (uint32[5], uint32));
        
        emit ReportDecrypted(msg.sender);
    }
    
    /// @notice Get encrypted category average
    function getEncryptedCategoryScore(address executive, uint256 category) 
        public view returns (euint32) 
    {
        require(category < 5, "Invalid category");
        return reports[executive].encryptedAvgScores[category];
    }
    
    /// @notice Get encrypted overall score
    function getEncryptedOverallScore(address executive) 
        public view onlyExecutive returns (euint32) 
    {
        return reports[executive].encryptedOverallScore;
    }
    
    /// @notice Set feedback collection period
    function setFeedbackPeriod(uint256 newPeriod) public {
        feedbackPeriod = newPeriod;
    }
}