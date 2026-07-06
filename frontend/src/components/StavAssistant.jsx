import React, { useState } from 'react';
import StavAvatar from '../assets/StavAIAssistant.png';

const Stavassistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  
  const [messages, setMessages] = useState([
    { sender: 'Stav', text: "Hey! I'm Stav your AI assistant. Ask me anything about RuBeer!" }
  ]);

  const toggleChat = () => setIsOpen(!isOpen);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    // 1. Instantly show the user's message
    const userText = inputMessage;
    setMessages(prev => [...prev, { sender: 'You', text: userText }]);
    setInputMessage('');

    try {
      // 2. Send the text to your Python backend
      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userText }),
      });

      const data = await response.json();

      // 3. Display Stav's real response from the server
      setMessages(prev => [...prev, { sender: 'Stav', text: data.reply }]);
      
    } catch (error) {
      console.error("Error talking to Stav:", error);
      setMessages(prev => [...prev, { sender: 'Stav', text: "Sorry, I'm having trouble connecting to the server right now!" }]);
    }
  };

  return (
    <div style={styles.assistantContainer}>
      {isOpen ? (
        <div style={styles.chatWindow}>
          
          {/* Top Header (Orange) */}
          <div style={styles.chatHeader}>
            <span>Chat with Stav</span>
            <div>
              <button onClick={toggleChat} style={styles.iconButton}>_</button>
              <button onClick={toggleChat} style={styles.iconButton}>X</button>
            </div>
          </div>
          
          {/* 
          */}
          <div style={{
            ...styles.chatBodyWrapper,
            backgroundImage: `url(${StavAvatar})`
          }}>
            
            {/* 
            */}
            <div style={styles.messageList}>
              {messages.map((msg, index) => (
                <div key={index} style={{
                  ...styles.messageBubble,
                  backgroundColor: msg.sender === 'Stav' ? 'rgba(34, 34, 34, 0.95)' : 'rgba(255, 152, 0, 0.95)',
                  color: msg.sender === 'Stav' ? '#ff9800' : '#000', 
                  alignSelf: msg.sender === 'Stav' ? 'flex-start' : 'flex-end',
                  border: msg.sender === 'Stav' ? '1px solid #ff9800' : 'none'
                }}>
                  <strong>{msg.sender}: </strong>{msg.text}
                </div>
              ))}
            </div>
            
          </div>

          <form onSubmit={handleSendMessage} style={styles.inputArea}>
            <input 
              type="text" 
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask Stav or Create a Dialogue..." 
              style={styles.inputField}
            />
            <button type="submit" style={styles.sendButton}>➤</button>
          </form>
        </div>
      ) : (
        <div style={styles.closedContainer}>
          <div onClick={toggleChat} style={styles.tooltipBubble}>
            Hey! I'm Stav, your AI Assistant. Ask me anything about RuBeer!
          </div>
          <button onClick={toggleChat} style={styles.avatarButton}>
            <img 
              src={StavAvatar} 
              alt="Stav AI Assistant" 
              style={styles.avatarImage} 
            />
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  assistantContainer: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: 9999,
    fontFamily: 'sans-serif',
  },
  
  closedContainer: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '15px',
  },
  tooltipBubble: {
    backgroundColor: '#000',
    color: '#ff9800',
    padding: '15px 20px',
    borderRadius: '15px 15px 0px 15px',
    maxWidth: '240px',
    border: '1px solid #ff9800',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
    fontSize: '14px',
    lineHeight: '1.5',
    marginBottom: '10px',
  },
  avatarButton: {
    width: '75px',
    height: '75px',
    borderRadius: '50%',
    border: '2px solid #ff9800',
    cursor: 'pointer',
    padding: 0,
    boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },

  chatWindow: {
    width: '340px',
    height: '600px', 
    backgroundColor: '#0a0a0a',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.9)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid #ff9800',
  },
  chatHeader: {
    backgroundColor: '#ff9800',
    color: '#000',
    padding: '12px 15px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: 'bold',
    fontSize: '16px',
    zIndex: 10, 
    boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
    flexshrink: 0, 
  },
  iconButton: {
    background: 'none',
    border: 'none',
    color: '#000',
    cursor: 'pointer',
    fontWeight: '900',
    marginLeft: '15px',
    fontSize: '16px',
  },
  
  chatBodyWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    backgroundSize: 'cover',
    backgroundPosition: 'center top',
    backgroundRepeat: 'no-repeat',
    backgroundColor: '#111', 
    overflow: 'hidden', 
  },

  messageList: {
    maxHeight: '40%',   
    overflowY: 'auto',
    padding: '15px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flexShrink: 0,     
    background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)',
  },
  
  messageBubble: {
    padding: '12px 16px',
    borderRadius: '15px',
    maxWidth: '85%',
    fontSize: '14px',
    lineHeight: '1.4',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)', 
  },
  
  inputArea: {
    display: 'flex',
    padding: '10px', 
    backgroundColor: '#111', 
    borderTop: '1px solid #ff9800', 
    zIndex: 10,
    flexshrink: 0,
  },
  inputField: {
    flex: 1,
    padding: '10px 15px', 
    borderRadius: '25px',
    border: '1px solid #ff9800',
    backgroundColor: '#000',
    color: '#ff9800',
    marginRight: '10px',
    outline: 'none',
    fontSize: '13px',
  },
  sendButton: {
    width: '36px', 
    height: '36px', 
    backgroundColor: '#ff9800',
    color: '#000',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
  }
};

export default Stavassistant;