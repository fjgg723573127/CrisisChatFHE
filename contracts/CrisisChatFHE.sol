// CrisisChatFHE.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CrisisChatFHE is SepoliaConfig {
    struct EncryptedMessage {
        uint256 id;
        euint32 encryptedContent; // Encrypted message content
        euint32 encryptedRiskScore; // Encrypted risk assessment score
        uint256 timestamp;
        bool isHighRisk;
    }
    
    struct DecryptedAlert {
        string content;
        uint32 riskScore;
        bool isDecrypted;
    }

    uint256 public messageCount;
    mapping(uint256 => EncryptedMessage) public encryptedMessages;
    mapping(uint256 => DecryptedAlert) public decryptedAlerts;
    
    euint32 private encryptedThreshold;
    mapping(uint256 => uint256) private requestToMessageId;
    
    address public counselor;
    bool private thresholdSet;
    
    event MessageSubmitted(uint256 indexed id, uint256 timestamp);
    event RiskAssessmentComplete(uint256 indexed id, bool isHighRisk);
    event AlertGenerated(uint256 indexed id);
    event DecryptionRequested(uint256 indexed id);
    event AlertDecrypted(uint256 indexed id);
    
    modifier onlyCounselor() {
        require(msg.sender == counselor, "Unauthorized");
        _;
    }
    
    constructor() {
        counselor = msg.sender;
    }

    /// @notice Initialize encrypted risk threshold
    function setEncryptedThreshold(euint32 _encryptedThreshold) public onlyCounselor {
        require(!thresholdSet, "Threshold already set");
        encryptedThreshold = _encryptedThreshold;
        thresholdSet = true;
    }

    /// @notice Submit encrypted chat message and risk score
    function submitEncryptedMessage(
        euint32 encryptedContent,
        euint32 encryptedRiskScore
    ) public {
        messageCount += 1;
        uint256 newId = messageCount;
        
        encryptedMessages[newId] = EncryptedMessage({
            id: newId,
            encryptedContent: encryptedContent,
            encryptedRiskScore: encryptedRiskScore,
            timestamp: block.timestamp,
            isHighRisk: false
        });
        
        decryptedAlerts[newId] = DecryptedAlert({
            content: "",
            riskScore: 0,
            isDecrypted: false
        });
        
        emit MessageSubmitted(newId, block.timestamp);
        _assessRisk(newId);
    }
    
    /// @notice Internal risk assessment using FHE
    function _assessRisk(uint256 messageId) private {
        EncryptedMessage storage message = encryptedMessages[messageId];
        ebool isHighRiskEncrypted = FHE.gt(message.encryptedRiskScore, encryptedThreshold);
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(isHighRiskEncrypted);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleRiskAssessment.selector);
        requestToMessageId[reqId] = messageId;
        
        emit DecryptionRequested(messageId);
    }
    
    /// @notice Handle risk assessment result
    function handleRiskAssessment(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 messageId = requestToMessageId[requestId];
        require(messageId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        bool isHighRisk = abi.decode(cleartexts, (bool));
        
        encryptedMessages[messageId].isHighRisk = isHighRisk;
        emit RiskAssessmentComplete(messageId, isHighRisk);
        
        if (isHighRisk) {
            emit AlertGenerated(messageId);
        }
    }
    
    /// @notice Request decryption of high-risk alert
    function requestAlertDecryption(uint256 messageId) public onlyCounselor {
        EncryptedMessage storage message = encryptedMessages[messageId];
        require(message.isHighRisk, "Not high risk");
        require(!decryptedAlerts[messageId].isDecrypted, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(message.encryptedContent);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleAlertDecryption.selector);
        requestToMessageId[reqId] = messageId;
        
        emit DecryptionRequested(messageId);
    }
    
    /// @notice Handle decrypted alert content
    function handleAlertDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 messageId = requestToMessageId[requestId];
        require(messageId != 0, "Invalid request");
        
        EncryptedMessage storage message = encryptedMessages[messageId];
        require(message.isHighRisk, "Not high risk");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        string memory content = abi.decode(cleartexts, (string));
        
        decryptedAlerts[messageId] = DecryptedAlert({
            content: content,
            riskScore: 0,
            isDecrypted: true
        });
        
        emit AlertDecrypted(messageId);
    }
    
    /// @notice Get decrypted alert details
    function getDecryptedAlert(uint256 messageId) public view onlyCounselor returns (
        string memory content,
        bool isDecrypted
    ) {
        DecryptedAlert storage alert = decryptedAlerts[messageId];
        return (alert.content, alert.isDecrypted);
    }
}