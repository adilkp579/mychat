// app.js (ES Module)

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc,
  collection, addDoc, onSnapshot, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// 🔥 Your Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyC2JA1K-fvsPUkWUfvSFhkC-ET8dpPOr0M",
  authDomain: "mychat-a97bf.firebaseapp.com",
  projectId: "mychat-a97bf",
  storageBucket: "mychat-a97bf.firebasestorage.app",
  messagingSenderId: "206620858913",
  appId: "1:206620858913:web:e8171ed8c1a2dbda3da160",
  measurementId: "G-83M844EY7B"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// WebRTC setup
let pc, localStream, roomId, unsubRoom, unsubCandidates;
const userId = crypto.randomUUID();

console.log('🆔 My User ID:', userId);

// Better STUN/TURN servers
const servers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ]
};

// 🎥 Initialize camera
async function initCamera() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, 
      audio: true 
    });
    
    const myFeed = document.getElementById("myFeed");
    const myPlaceholder = document.getElementById("myPlaceholder");
    const myCamera = document.getElementById("myCamera");
    
    myFeed.srcObject = localStream;
    await myFeed.play();
    myFeed.style.display = "block";
    myPlaceholder.style.display = "none";
    myCamera.classList.add("active");
    
    console.log('📷 Camera started');
    return localStream;
  } catch (err) {
    console.error("❌ Camera error:", err);
    alert('Camera access needed. Please allow permissions.');
    throw err;
  }
}

// 🚪 Join queue to find stranger
async function joinQueue() {
  console.log('🔍 Joining queue...');
  
  try {
    const waitingDoc = doc(db, "queue", "waiting");
    const snap = await getDoc(waitingDoc);

    console.log('Queue snapshot exists:', snap.exists());
    
    if (!snap.exists()) {
      // No one waiting - become the waiter
      await setDoc(waitingDoc, { 
        userId: userId, 
        created: serverTimestamp() 
      });
      console.log('⏳ I am waiting for a stranger...');
      listenForMatch();
    } else {
      const data = snap.data();
      console.log('Queue data:', data);
      
      if (data.userId && data.userId !== userId) {
        // Someone is waiting - connect with them
        const otherUserId = data.userId;
        console.log('🔗 Found stranger:', otherUserId);
        
        await deleteDoc(waitingDoc);
        console.log('🗑️ Deleted queue doc');
        
        await createRoom(otherUserId, true);
      } else if (data.userId === userId) {
        console.log('⚠️ Found myself in queue, listening...');
        listenForMatch();
      }
    }
  } catch (err) {
    console.error("❌ Queue error:", err);
    window.videoChat.setSearching(false);
    window.videoChat.showDisconnected();
    alert('Connection error. Please try again.');
  }
}

// 👂 Listen for stranger match
function listenForMatch() {
  console.log('👂 Listening for match...');
  
  const waitingDoc = doc(db, "queue", "waiting");
  
  unsubRoom = onSnapshot(waitingDoc, async (snap) => {
    console.log('📡 Queue snapshot update:', snap.exists() ? snap.data() : 'deleted');
    
    if (!snap.exists()) {
      // Someone deleted it - might be picked up
      console.log('Queue doc deleted');
      return;
    }
    
    const data = snap.data();
    if (data && data.userId && data.userId !== userId) {
      console.log('🎯 Match found with:', data.userId);
      
      // Stop listening
      if (unsubRoom) {
        unsubRoom();
        unsubRoom = null;
      }
      
      // Delete queue
      await deleteDoc(waitingDoc).catch(() => {});
      
      // Create room (I am NOT the caller since other person was waiting)
      await createRoom(data.userId, false);
    }
  }, (err) => {
    console.error('❌ Listen error:', err);
  });
}

// 🏠 Create WebRTC room
async function createRoom(otherUser, isCaller) {
  console.log('🏠 Creating room with:', otherUser, 'isCaller:', isCaller);
  
  roomId = [userId, otherUser].sort().join("_");
  console.log('📁 Room ID:', roomId);
  
  const roomRef = doc(db, "rooms", roomId);

  // Update UI
  window.videoChat.setSearching(false);
  window.videoChat.showConnected();
  window.videoChat.startTimer();
  window.videoChat.setStrangerInfo('🌍', 'Connected!');

  // Create peer connection
  pc = new RTCPeerConnection(servers);
  console.log('🔗 PeerConnection created');

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(t => {
      console.log('➕ Adding track:', t.kind);
      pc.addTrack(t, localStream);
    });
  }

  // Handle incoming stream
  pc.ontrack = (e) => {
    console.log('📥 Received remote track, streams:', e.streams.length);
    const strangerFeed = document.getElementById("strangerFeed");
    const strangerPlaceholder = document.getElementById("strangerPlaceholder");
    const strangerCamera = document.getElementById("strangerCamera");
    
    if (e.streams[0]) {
      strangerFeed.srcObject = e.streams[0];
      strangerFeed.style.display = "block";
      strangerPlaceholder.style.display = "none";
      strangerCamera.classList.add("connected");
      console.log('✅ Remote stream displayed');
    }
  };

  // ICE candidates
  pc.onicecandidate = async (e) => {
    if (e.candidate) {
      console.log('🧊 New ICE candidate');
      try {
        await addDoc(collection(roomRef, "candidates"), e.candidate.toJSON());
      } catch (err) {
        console.error("❌ ICE save error:", err);
      }
    } else {
      console.log('🧊 ICE gathering complete');
    }
  };

  // Connection state changes
  pc.onconnectionstatechange = () => {
    console.log('🔗 Connection state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      console.log('✅✅✅ Successfully connected!');
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      console.log('❌ Connection lost');
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('🧊 ICE connection state:', pc.iceConnectionState);
  };

  // Caller creates offer
  if (isCaller) {
    try {
      console.log('📞 Creating offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setDoc(roomRef, { 
        offer: {
          type: offer.type,
          sdp: offer.sdp
        },
        created: serverTimestamp() 
      });
      console.log('📞 Offer saved to Firestore');
    } catch (err) {
      console.error("❌ Offer error:", err);
    }
  }

  // Listen for signaling
  onSnapshot(roomRef, async (snap) => {
    const data = snap.data();
    if (!data) {
      console.log('📡 Room data: empty');
      return;
    }
    
    console.log('📡 Room data:', Object.keys(data));

    try {
      // I am answerer, I receive offer
      if (data.offer && !pc.currentRemoteDescription && !isCaller) {
        console.log('📩 Received offer, creating answer...');
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(roomRef, { 
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        });
        console.log('📞 Answer saved to Firestore');
      }

      // I am caller, I receive answer
      if (data.answer && !pc.currentRemoteDescription && isCaller) {
        console.log('📩 Received answer, setting remote...');
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('✅ Connection should be established');
      }
    } catch (err) {
      console.error("❌ Signaling error:", err);
    }
  });

  // Listen for ICE candidates
  unsubCandidates = onSnapshot(collection(roomRef, "candidates"), (snap) => {
    snap.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const candidateData = change.doc.data();
        console.log('🧊 Received ICE candidate');
        try {
          if (pc && candidateData) {
            await pc.addIceCandidate(new RTCIceCandidate(candidateData));
          }
        } catch (err) {
          console.error("❌ Add ICE error:", err);
        }
      }
    });
  });
}

// ⏭️ Next stranger
async function nextStranger() {
  console.log('⏭️ Finding next stranger...');
  window.videoChat.setNextSearching(true);
  
  cleanup();
  
  // Small delay before rejoining
  setTimeout(async () => {
    await joinQueue();
    window.videoChat.setNextSearching(false);
  }, 500);
}

// 🛑 Stop chat
function stopChat() {
  console.log('🛑 Stopping chat...');
  cleanup();
  window.videoChat.stopTimer();
  window.videoChat.showDisconnected();
  window.videoChat.setStrangerInfo(null, null);
  window.videoChat.setSearching(false);
  
  // Stop camera
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  
  const myFeed = document.getElementById("myFeed");
  const myPlaceholder = document.getElementById("myPlaceholder");
  const myCamera = document.getElementById("myCamera");
  myFeed.style.display = "none";
  myFeed.srcObject = null;
  myPlaceholder.style.display = "flex";
  myCamera.classList.remove("active");
  
  // Reset stranger feed
  const strangerFeed = document.getElementById("strangerFeed");
  const strangerPlaceholder = document.getElementById("strangerPlaceholder");
  const strangerCamera = document.getElementById("strangerCamera");
  strangerFeed.style.display = "none";
  strangerFeed.srcObject = null;
  strangerPlaceholder.style.display = "flex";
  strangerCamera.classList.remove("connected");
}

// 🧹 Cleanup
function cleanup() {
  if (pc) {
    pc.close();
    pc = null;
  }
  if (unsubRoom && typeof unsubRoom === 'function') {
    unsubRoom();
    unsubRoom = null;
  }
  if (unsubCandidates && typeof unsubCandidates === 'function') {
    unsubCandidates();
    unsubCandidates = null;
  }
  if (roomId) {
    deleteDoc(doc(db, "rooms", roomId)).catch(() => {});
    roomId = null;
  }
  window.videoChat.setRecording(false);
}

// 🎬 Start chat
async function startChat() {
  console.log('🎬 Starting chat...');
  window.videoChat.setSearching(true);
  
  try {
    await initCamera();
    await joinQueue();
  } catch (err) {
    console.error("❌ Start error:", err);
    window.videoChat.setSearching(false);
    window.videoChat.showDisconnected();
  }
}

// Toggle recording
function toggleRecord() {
  if (window.videoChat.isRecording) {
    window.videoChat.setRecording(false);
    console.log('⏹️ Recording stopped');
  } else {
    if (!pc || pc.connectionState !== 'connected') {
      alert('Connect with a stranger first!');
      return;
    }
    window.videoChat.setRecording(true);
    console.log('🔴 Recording started');
  }
}

// Override the stubs
if (window.videoChat) {
  window.videoChat.start = startChat;
  window.videoChat.stop = stopChat;
  window.videoChat.next = nextStranger;
  window.videoChat.toggleRecord = toggleRecord;
}

console.log('✅ app.js loaded - Ready!');
console.log('📋 Instructions:');
console.log('1. Make sure Firestore rules allow read/write');
console.log('2. Open two browser tabs to test');
console.log('3. Click Start on both tabs');
