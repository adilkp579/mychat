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
let pc, localStream, roomId, unsubRoom;
const userId = crypto.randomUUID();

const servers = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// 🎥 Initialize camera
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
    const myFeed = document.getElementById("myFeed");
    const myPlaceholder = document.getElementById("myPlaceholder");
    const myCamera = document.getElementById("myCamera");
    
    myFeed.srcObject = localStream;
    await myFeed.play();
    myFeed.style.display = "block";
    myPlaceholder.style.display = "none";
    myCamera.classList.add("active");
    
    return localStream;
  } catch (err) {
    console.error("Camera error:", err);
    alert('Camera access needed. Please allow permissions.');
    throw err;
  }
}

// 🚪 Join queue to find stranger
async function joinQueue() {
  const queueRef = collection(db, "queue");
  const waitingDoc = doc(db, "queue", "waiting");
  
  try {
    const snap = await getDoc(waitingDoc);

    if (!snap.exists()) {
      // No one waiting - become the waiter
      await setDoc(waitingDoc, { userId, created: serverTimestamp() });
      console.log('⏳ Waiting for stranger...');
      listenForMatch(waitingDoc);
    } else {
      // Someone is waiting - connect with them
      const other = snap.data().userId;
      if (other !== userId) {
        await deleteDoc(waitingDoc);
        console.log('🔗 Stranger found! Connecting...');
        await createRoom(other, true);
      }
    }
  } catch (err) {
    console.error("Queue error:", err);
    window.videoChat.setSearching(false);
    window.videoChat.showDisconnected();
  }
}

// 👂 Listen for stranger match
function listenForMatch(waitingDoc) {
  unsubRoom = onSnapshot(waitingDoc, async (snap) => {
    if (!snap.exists()) {
      // Document deleted - someone picked us up
      return;
    }
    const data = snap.data();
    if (data && data.userId !== userId) {
      // Found a match
      await deleteDoc(waitingDoc);
      if (unsubRoom) unsubRoom();
      console.log('🔗 Match found! Creating room...');
      await createRoom(data.userId, false);
    }
  });
}

// 🏠 Create WebRTC room
async function createRoom(otherUser, isCaller) {
  roomId = [userId, otherUser].sort().join("_");
  const roomRef = doc(db, "rooms", roomId);

  // Update UI
  window.videoChat.setSearching(false);
  window.videoChat.showConnected();
  window.videoChat.startTimer();
  window.videoChat.setStrangerInfo('🌍', 'Connected!');

  // Create peer connection
  pc = new RTCPeerConnection(servers);

  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  // Handle incoming stream
  pc.ontrack = (e) => {
    const strangerFeed = document.getElementById("strangerFeed");
    const strangerPlaceholder = document.getElementById("strangerPlaceholder");
    const strangerCamera = document.getElementById("strangerCamera");
    
    strangerFeed.srcObject = e.streams[0];
    strangerFeed.style.display = "block";
    strangerPlaceholder.style.display = "none";
    strangerCamera.classList.add("connected");
  };

  // ICE candidates
  pc.onicecandidate = async (e) => {
    if (e.candidate) {
      try {
        await addDoc(collection(roomRef, "candidates"), e.candidate.toJSON());
      } catch (err) {
        console.error("ICE candidate error:", err);
      }
    }
  };

  // Connection state changes
  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      console.log('❌ Connection lost');
    }
  };

  // Caller creates offer
  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setDoc(roomRef, { offer, created: serverTimestamp() });
      console.log('📞 Offer sent');
    } catch (err) {
      console.error("Offer error:", err);
    }
  }

  // Listen for signaling
  onSnapshot(roomRef, async (snap) => {
    const data = snap.data();
    if (!data) return;

    try {
      // Answerer receives offer
      if (data.offer && !pc.currentRemoteDescription && !isCaller) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(roomRef, { answer });
        console.log('📞 Answer sent');
      }

      // Caller receives answer
      if (data.answer && !pc.currentRemoteDescription && isCaller) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('✅ Connection established');
      }
    } catch (err) {
      console.error("Signaling error:", err);
    }
  });

  // Listen for ICE candidates
  onSnapshot(collection(roomRef, "candidates"), (snap) => {
    snap.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        } catch (err) {
          console.error("Add ICE error:", err);
        }
      }
    });
  });
}

// ⏭️ Next stranger
async function nextStranger() {
  console.log('⏭️ Finding next stranger...');
  window.videoChat.setNextSearching(true);
  
  // Cleanup current connection
  cleanup();
  
  // Rejoin queue
  await joinQueue();
}

// 🛑 Stop chat
function stopChat() {
  console.log('🛑 Stopping chat...');
  cleanup();
  window.videoChat.stopTimer();
  window.videoChat.showDisconnected();
  window.videoChat.setStrangerInfo(null, null);
  
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
    console.error("Start error:", err);
    window.videoChat.setSearching(false);
    window.videoChat.showDisconnected();
  }
}

// Toggle recording
function toggleRecord() {
  if (window.videoChat.isRecording) {
    window.videoChat.setRecording(false);
  } else {
    window.videoChat.setRecording(true);
  }
}

// Override the stubs in window.videoChat
if (window.videoChat) {
  window.videoChat.start = startChat;
  window.videoChat.stop = stopChat;
  window.videoChat.next = nextStranger;
  window.videoChat.toggleRecord = toggleRecord;
}

console.log('✅ app.js loaded - Omegle-style video chat ready');
