(() => {
  const BOOKING_API_URL = "https://eden-audit-chat.onrender.com/booking-chat";
  let bookingSessionId = localStorage.getItem("bookingSessionId");
  if (!bookingSessionId) {
    bookingSessionId = "booking_" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("bookingSessionId", bookingSessionId);
  }
  const messages = document.getElementById("booking-messages");
  const input = document.getElementById("booking-input");
  const sendBtn = document.getElementById("booking-send");
  if (!messages || !input || !sendBtn) return;
  const add = (text, sender, loading=false) => {
    const div = document.createElement("div");
    div.className = "booking-msg " + (sender === "user" ? "booking-user" : "booking-bot") + (loading ? " booking-loading" : "");
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  };
  const send = async () => {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    add(text,"user"); input.value=""; sendBtn.disabled=true;
    const loading = add("AI receptionist is typing...","bot",true);
    try {
      const response = await fetch(BOOKING_API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,sessionId:bookingSessionId})});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const data = await response.json();
      loading.remove();
      add(data.reply || "Got it 😊 would you like tomorrow at 2 PM or 4 PM?","bot");
    } catch (error) {
      loading.remove();
      add("Small connection issue. Please try again in a moment.","bot");
    } finally {
      sendBtn.disabled=false; input.focus();
    }
  };
  sendBtn.addEventListener("click",send);
  input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}});
})();
