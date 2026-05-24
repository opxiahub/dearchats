import type { Message } from "@/lib/types";

interface Props {
  msg: Message;
  isUser: boolean;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

export default function ChatBubble({ msg, isUser }: Props) {
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[80%] min-w-0 px-4 py-2.5 rounded-2xl text-[15px] leading-snug ${
          isUser
            ? "bg-rose/90 text-ink rounded-br-sm"
            : "bg-parchment/10 text-parchment rounded-bl-sm"
        }`}
      >
        <div className="whitespace-pre-wrap break-words overflow-wrap-anywhere">{msg.text}</div>
        <div className={`text-[10px] mt-1 ${isUser ? "text-ink/50" : "text-mist/60"} text-right`}>
          {formatTime(msg.ts)}
        </div>
      </div>
    </div>
  );
}
