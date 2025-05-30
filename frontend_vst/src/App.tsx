import { useState, useRef, useEffect } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWebRTC } from '@/lib/useWebRTC'; // Import the hook

export default function App() {
  const [roomNameInput, setRoomNameInput] = useState<string>(""); // For the input field
  const webRTC = useWebRTC(); // Use the hook

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && webRTC.localStream) {
      localVideoRef.current.srcObject = webRTC.localStream;
    } else if (localVideoRef.current) {
      // Clear the stream if localStream becomes null (e.g. camera turned off)
      localVideoRef.current.srcObject = null;
    }
  }, [webRTC.localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && webRTC.remoteStream) {
      remoteVideoRef.current.srcObject = webRTC.remoteStream;
    } else if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null; // Clear if remote stream is null
    }
  }, [webRTC.remoteStream]);

  const handleToggleCamera = async () => {
    await webRTC.toggleCamera();
  };

  const handleJoinOrLeaveRoom = () => {
    if (webRTC.isInRoom) {
      webRTC.leaveRoom();
      // setRoomNameInput(""); // Optionally clear input on leave, user might want to re-enter same room or similar.
    } else {
      if (!roomNameInput.trim()) {
        alert("Please enter a room name.");
        return;
      }
      webRTC.setRoomNameCallback(roomNameInput); // Important: Set room name in hook before joining
      webRTC.joinRoom(roomNameInput);
    }
  };

  return (
    <div className="container mx-auto p-4 min-h-screen flex flex-col items-center">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <h1 className="text-3xl font-bold mb-6">Video Chat MVP</h1>
      {/* Client ID display for debugging */}
      {webRTC.clientId && <p className="text-sm text-muted-foreground mb-2">My ID: {webRTC.clientId} (Room: {webRTC.roomName})</p>}


      <Card className="w-full max-w-2xl mb-6">
        <CardHeader>
          <CardTitle>Controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex space-x-2">
            <Input
              type="text"
              placeholder="Enter room name"
              value={roomNameInput}
              onChange={(e) => setRoomNameInput(e.target.value)}
              disabled={webRTC.isInRoom}
              className="flex-grow"
            />
            <Button onClick={handleJoinOrLeaveRoom} disabled={!roomNameInput.trim() && !webRTC.isInRoom}>
              {webRTC.isInRoom ? "Leave Room" : "Join Room"}
            </Button>
          </div>
          <Button onClick={handleToggleCamera} variant="outline" disabled={!webRTC.isInRoom && !webRTC.isCameraOn}>
            {/* Disable toggle if not in room and camera is off. Allow turning off if in room. Allow turning on anytime. */}
            {/* Simpler: disable if trying to turn on and not in room (depends on desired UX) */}
            {/* For now, let toggleCamera manage its internal logic of when it can/cannot operate */}
            {webRTC.isCameraOn ? "Stop Camera" : "Start Camera"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Local Video</CardTitle>
          </CardHeader>
          <CardContent>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto bg-muted rounded"
            />
            {!webRTC.localStream && <p className="text-muted-foreground text-center p-4">Camera is off or not started</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Remote Video</CardTitle>
          </CardHeader>
          <CardContent>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-auto bg-muted rounded"
            />
            {!webRTC.isInRoom && <p className="text-muted-foreground text-center p-4">Not in a room</p>}
            {webRTC.isInRoom && !webRTC.remoteStream && <p className="text-muted-foreground text-center p-4">Waiting for remote user, or they have no video.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
