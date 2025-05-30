import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SIGNALING_SERVER_URL = 'http://localhost:3000'; // Adjust if backend runs elsewhere

// Consider using a more robust STUN server list for production
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface UseWebRTCReturn {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCameraOn: boolean;
  isInRoom: boolean;
  roomName: string;
  clientId: string | null; // Socket ID
  toggleCamera: () => Promise<void>;
  joinRoom: (name: string) => void;
  leaveRoom: () => void;
  setRoomNameCallback: (name: string) => void; // To update internal roomName state from App
}

export const useWebRTC = (): UseWebRTCReturn => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isInRoom, setIsInRoom] = useState<boolean>(false);
  const [roomName, setRoomNameInternal] = useState<string>(""); // Internal room name
  const [clientId, setClientId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  // To keep track of connected peers if expanding to more than one-to-one
  // For MVP, primarily one peer connection.
  const remoteClientIdRef = useRef<string | null>(null);

  // Function to be called from App.tsx to update the hook's roomName state
  const setRoomNameCallback = useCallback((name: string) => {
     setRoomNameInternal(name);
  }, []);

  // Initialize Socket.IO connection
  useEffect(() => {
    socketRef.current = io(SIGNALING_SERVER_URL);
    // Note: socket.id might not be immediately available here.
    // It's better to set it within the 'connect' event listener.
    // setClientId(socketRef.current.id || null); // Removed for consistency

    socketRef.current.on('connect', () => {
      console.log('Connected to signaling server, ID:', socketRef.current?.id);
      setClientId(socketRef.current?.id || null);
    });

    socketRef.current.on('user-joined', (joinedUserId: string) => {
      console.log('User joined room:', joinedUserId);
      remoteClientIdRef.current = joinedUserId;
      // If this client is the first one, it might need to initiate the offer
      // Or if another user joins, this client (if already in room) might make an offer
      if (peerConnectionRef.current && localStream) {
         createOffer();
      }
    });

    socketRef.current.on('offer', async (data: { sdp: RTCSessionDescriptionInit, senderId: string }) => {
      console.log('Received offer from', data.senderId);
      if (!peerConnectionRef.current) {
        // Ensure peer connection is set up. This might happen if the offer arrives very quickly.
        await setupPeerConnection();
      }
      if (peerConnectionRef.current && data.sdp) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          remoteClientIdRef.current = data.senderId;
          await createAnswer();
        } catch (error) {
          console.error('Error setting remote description or creating answer:', error);
        }
      }
    });

    socketRef.current.on('answer', async (data: { sdp: RTCSessionDescriptionInit, senderId: string }) => {
      console.log('Received answer from', data.senderId);
      if (peerConnectionRef.current && data.sdp) {
        try {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (error) {
          console.error('Error setting remote description from answer:', error);
        }
      }
    });

    socketRef.current.on('ice-candidate', (data: { candidate: RTCIceCandidateInit, senderId: string }) => {
      console.log('Received ICE candidate from', data.senderId);
      if (peerConnectionRef.current && data.candidate) {
        try {
          peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (error) {
          console.error('Error adding received ICE candidate:', error);
        }
      }
    });

    socketRef.current.on('user-left', (leftUserId: string) => {
      console.log('User left room:', leftUserId);
      if (remoteClientIdRef.current === leftUserId) {
        setRemoteStream(null);
        remoteClientIdRef.current = null;
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null; // Important to nullify to allow re-creation
        }
      }
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [localStream]); // Added localStream dependency for cleanup consistency

  const setupPeerConnection = useCallback(async () => {
     // This check is important. If called without a local stream, tracks won't be added initially.
     // if (!localStream) {
     //    console.warn("Attempting to set up peer connection without a local stream.");
     // }

     peerConnectionRef.current = new RTCPeerConnection({ iceServers: ICE_SERVERS });

     peerConnectionRef.current.onicecandidate = (event) => {
       if (event.candidate && socketRef.current && roomName) { // roomName check is crucial
         socketRef.current.emit('ice-candidate', {
           candidate: event.candidate,
           roomName: roomName, // Use the internal roomName state of the hook
         });
       }
     };

     peerConnectionRef.current.ontrack = (event) => {
       console.log('Remote track received:', event.streams[0]);
       setRemoteStream(event.streams[0]);
     };

     if (localStream) {
         localStream.getTracks().forEach(track => {
             if (peerConnectionRef.current) { // Check if current is not null
                 peerConnectionRef.current.addTrack(track, localStream);
             }
         });
     }
     // Return the created peer connection, though not strictly necessary for this hook's internal use
     return peerConnectionRef.current;
  }, [localStream, roomName]); // roomName dependency for onicecandidate


  const createOffer = useCallback(async () => {
    // Ensure peer connection is set up before creating offer.
    if (!peerConnectionRef.current) {
        await setupPeerConnection();
    }
    if (!peerConnectionRef.current || !socketRef.current || !roomName) {
        console.warn("Cannot create offer: PC, socket, or roomName not available.", {pc: !!peerConnectionRef.current, socket: !!socketRef.current, roomName});
        return;
    }
    console.log('Creating offer for room:', roomName);
    try {
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      socketRef.current.emit('offer', { sdp: offer, roomName: roomName });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  }, [roomName, setupPeerConnection]);

  const createAnswer = useCallback(async () => {
    // Ensure peer connection is set up before creating answer.
    if (!peerConnectionRef.current) {
        // This path should ideally not be hit if offer handling is correct
        console.warn("Creating answer: PeerConnection not ready, setting up now.");
        await setupPeerConnection();
    }
    if (!peerConnectionRef.current || !socketRef.current || !roomName) {
        console.warn("Cannot create answer: PC, socket, or roomName not available.");
        return;
    }
    console.log('Creating answer for room:', roomName);
    try {
      const answer = await peerConnectionRef.current.createAnswer();
      await peerConnectionRef.current.setLocalDescription(answer);
      socketRef.current.emit('answer', { sdp: answer, roomName: roomName });
    } catch (error) {
      console.error('Error creating answer:', error);
    }
  }, [roomName, setupPeerConnection]);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        if (peerConnectionRef.current) {
             const senders = peerConnectionRef.current.getSenders();
             senders.forEach(sender => {
                 if (sender.track && localStream.getTracks().includes(sender.track)) {
                     peerConnectionRef.current?.removeTrack(sender);
                 }
             });
             // After removing tracks, if in a call, renegotiation (new offer) might be needed.
             // For MVP, this might lead to the other side's video freezing or stopping.
             // A more robust solution would involve sending a "tracks-removed" signal or re-offering.
        }
        setLocalStream(null);
      }
      setIsCameraOn(false);
      console.log("Camera stopped, local stream cleared.");
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        setIsCameraOn(true);
        console.log("Camera started, local stream set.");
        // If peer connection exists and we are in a room, add new tracks and potentially renegotiate.
        if (peerConnectionRef.current && isInRoom) {
          stream.getTracks().forEach(track => {
            peerConnectionRef.current?.addTrack(track, stream);
          });
          console.log("Tracks added to existing peer connection.");
          // Consider if renegotiation is needed here. If we are the offerer or if this changes media significantly.
          // For example, if we joined without video and now add it.
          // await createOffer(); // This could be one way to handle it, might need flags to control.
        }
      } catch (error) {
        console.error('Error accessing media devices.', error);
        setIsCameraOn(false); // Ensure state reflects reality
      }
    }
  }, [isCameraOn, localStream, isInRoom]); // Added isInRoom

  const joinRoom = useCallback(async (name: string) => {
    if (!socketRef.current || !name.trim()) {
        console.warn("Socket not available or room name empty for joinRoom.");
        return;
    }
    // It's crucial that roomName (internal state) is set for other operations like ICE candidate emission.
    setRoomNameInternal(name);
    setIsInRoom(true);

    if (!peerConnectionRef.current) {
      await setupPeerConnection();
    }

    // Ensure tracks are added if localStream is available
    // This is important if camera was turned on *before* joining the room.
    if (localStream && peerConnectionRef.current) {
         let tracksAddedOrExisting = 0;
         localStream.getTracks().forEach(track => {
             const senderExists = peerConnectionRef.current?.getSenders().find(s => s.track === track);
             if (!senderExists) {
                 peerConnectionRef.current?.addTrack(track, localStream);
                 tracksAddedOrExisting++;
             } else {
                 tracksAddedOrExisting++;
             }
         });
         if (tracksAddedOrExisting > 0) console.log("Local tracks present/added to peer connection for room", name);
    } else if (!localStream) {
      console.warn("Joining room without local stream. Camera is off.");
    }

    socketRef.current.emit('join-room', name);
    console.log('Emitted join-room for room:', name);
    // Offer creation is now primarily handled by 'user-joined' from the other side,
    // or by this client if it receives 'user-joined'.
    // The `createOffer` in `user-joined` handler covers the case where this client is already in the room
    // and another user joins. If this client is the one joining, it will wait for an offer,
    // or the other client's 'user-joined' will trigger their offer.
  }, [localStream, setupPeerConnection]); // Removed `roomName` from deps, using `name` arg and `setRoomNameInternal`

  const leaveRoom = useCallback(() => {
    if (socketRef.current && roomName) { // Use internal roomName
      // socketRef.current.emit('leave-room', roomName); // Optional: if backend handles this
      console.log('Leaving room:', roomName);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    // Do not stop localStream here, user might want to keep camera on for next call.
    // Local stream cleanup is now in the main useEffect return for component unmount.
    setRemoteStream(null);
    setIsInRoom(false);
    // setRoomNameInternal(""); // Clearing roomName might be desired, or App can manage.
    remoteClientIdRef.current = null;
    console.log("Left room, client state reset.");
  }, [roomName]); // Use internal roomName

  return {
     localStream,
     remoteStream,
     isCameraOn,
     isInRoom,
     roomName, // Expose internal roomName state
     clientId,
     toggleCamera,
     joinRoom,
     leaveRoom,
     setRoomNameCallback // Expose the callback to set internal roomName from App
 };
};
