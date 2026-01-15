import { io, Socket } from "socket.io-client";
import { Condition, Message } from "../types";

// REPLACE THIS WITH YOUR DEPLOYED CLOUD RUN URL OR LOCALHOST
const SOCKET_URL = "http://localhost:8080"; 

class SocketService {
  private socket: Socket | null = null;
  private roomId: string | null = null;

  connect() {
    if (this.socket?.connected) return;
    
    this.socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 5,
    });

    this.socket.on("connect", () => {
      console.log("Connected to socket server");
    });
  }

  joinQueue(condition: Condition, onMatchFound: () => void) {
    if (!this.socket) this.connect();

    this.socket?.emit("join_queue", { condition });
    
    this.socket?.on("match_found", (data: { roomId: string }) => {
      this.roomId = data.roomId;
      onMatchFound();
    });
  }

  sendMessage(text: string) {
    if (this.socket && this.roomId) {
      this.socket.emit("send_message", { roomId: this.roomId, text });
    }
  }

  onReceiveMessage(callback: (msg: Message) => void) {
    if (!this.socket) return;
    
    // Remove existing listeners to avoid duplicates
    this.socket.off("receive_message");

    this.socket.on("receive_message", (data: any) => {
      const msg: Message = {
        id: 'soc-' + Date.now() + Math.random(),
        sender: 'agent',
        text: data.text,
        timestamp: data.timestamp
      };
      callback(msg);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.roomId = null;
    }
  }
}

export const socketService = new SocketService();