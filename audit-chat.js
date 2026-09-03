(function clinicAuditChat2026() {

const CLINIC_AUDIT_CHAT_API_URL_2026 =
"https://eden-audit-chat.onrender.com/audit-chat";

const CLINIC_AUDIT_REALTIME_URL_2026 =
"https://eden-audit-chat.onrender.com/audit-realtime-call";

const CLINIC_AUDIT_VOICE_INTAKE_URL_2026 =
"https://eden-audit-chat.onrender.com/audit-voice-intake";

const CLINIC_AUDIT_STORAGE_KEY_2026 =
"clinicRevenueRescueAuditSession2026";

const CLINIC_AUDIT_TYPE_KNOWN_KEY_2026 =
"clinicRevenueRescueAuditTypeKnown2026";

let clinicAuditSessionId2026 =
localStorage.getItem(
CLINIC_AUDIT_STORAGE_KEY_2026
);

if (!clinicAuditSessionId2026) {

clinicAuditSessionId2026 =
"clinic_audit_" +
Math.random().toString(36).substring(2) +
Date.now();

localStorage.setItem(
CLINIC_AUDIT_STORAGE_KEY_2026,
clinicAuditSessionId2026
);

}

const clinicAuditRoot2026 =
document.getElementById(
"clinic-audit-chat-2026"
);

if (!clinicAuditRoot2026) {
return;
}

const clinicAuditMessages2026 =
document.getElementById(
"clinic-audit-messages-2026"
);

const clinicAuditInput2026 =
document.getElementById(
"clinic-audit-input-2026"
);

const clinicAuditSendButton2026 =
document.getElementById(
"clinic-audit-send-2026"
);

const clinicAuditVoiceButton2026 =
document.getElementById(
"clinic-audit-voice-button-2026"
);

const clinicAuditQuickReplies2026 =
document.getElementById(
"clinic-audit-quick-replies-2026"
);

if (
!clinicAuditMessages2026 ||
!clinicAuditInput2026 ||
!clinicAuditSendButton2026
) {
return;
}

if (clinicAuditQuickReplies2026) {
clinicAuditQuickReplies2026.style.display =
localStorage.getItem(
CLINIC_AUDIT_TYPE_KNOWN_KEY_2026
) === "true"
? "none"
: "grid";
}

/* ADD A MESSAGE BUBBLE */

function clinicAuditAddMessage2026(
text,
sender,
isLoading
) {

const messageElement =
document.createElement("div");

messageElement.className =
"clinic-audit-chat-message-2026 " +
(
sender === "user"
? "clinic-audit-chat-user-2026"
: "clinic-audit-chat-bot-2026"
);

if (isLoading) {
messageElement.classList.add(
"clinic-audit-chat-loading-2026"
);

messageElement.setAttribute(
"aria-label",
"Mia is typing"
);

messageElement.innerHTML =
'<span class="clinic-audit-typing-dots-2026" aria-hidden="true">' +
'<i></i><i></i><i></i></span>';
} else {
messageElement.textContent = text;
}

clinicAuditMessages2026.appendChild(
messageElement
);

clinicAuditMessages2026.scrollTop =
clinicAuditMessages2026.scrollHeight;

return messageElement;

}

function clinicAuditAddSystemMessage2026(text) {

const messageElement =
document.createElement("div");

messageElement.className =
"clinic-audit-chat-message-2026 clinic-audit-chat-bot-2026";

messageElement.style.maxWidth = "94%";
messageElement.style.margin = "4px auto 12px";
messageElement.style.padding = "9px 12px";
messageElement.style.borderRadius = "12px";
messageElement.style.background =
"rgba(17,24,66,.08)";
messageElement.style.color =
"rgba(17,24,66,.72)";
messageElement.style.fontSize = "12px";
messageElement.style.textAlign = "center";

messageElement.textContent = text;

clinicAuditMessages2026.appendChild(
messageElement
);

clinicAuditMessages2026.scrollTop =
clinicAuditMessages2026.scrollHeight;

return messageElement;

}

/* SEND MESSAGE TO MIA */

async function clinicAuditSendMessage2026(
customText
) {

const messageText =
(
customText ||
clinicAuditInput2026.value ||
""
).trim();

if (!messageText) {
return;
}

const clinicAuditQuickRepliesWereVisible2026 =
clinicAuditQuickReplies2026 &&
window.getComputedStyle(
clinicAuditQuickReplies2026
).display !== "none";

if (
clinicAuditQuickReplies2026 &&
Boolean(customText)
) {
clinicAuditQuickReplies2026.style.display =
"none";
}

clinicAuditAddMessage2026(
messageText,
"user",
false
);

clinicAuditInput2026.value = "";
clinicAuditInput2026.style.height = "auto";

clinicAuditSendButton2026.disabled = true;

const clinicAuditThinkingStartedAt2026 =
Date.now();

const loadingMessage =
clinicAuditAddMessage2026(
"Mia is typing",
"bot",
true
);

try {

const response =
await fetch(
CLINIC_AUDIT_CHAT_API_URL_2026,
{
method: "POST",

headers: {
"Content-Type": "application/json"
},

body: JSON.stringify({
message: messageText,
sessionId: clinicAuditSessionId2026
})
}
);

if (!response.ok) {
throw new Error(
"Audit chat request failed: " +
response.status
);
}

const data =
await response.json();

const miaReply =
data.reply ||
data.message ||
data.response ||
"Thank you. What would you most like to improve: missed calls, slow replies, or booking conversion?";

const clinicAuditMinimumThinkingMs2026 =
Math.min(
1800,
700 + String(miaReply).length * 7
);

const clinicAuditRemainingThinkingMs2026 =
clinicAuditMinimumThinkingMs2026 -
(Date.now() - clinicAuditThinkingStartedAt2026);

if (clinicAuditRemainingThinkingMs2026 > 0) {
await new Promise(function (resolve) {
window.setTimeout(
resolve,
clinicAuditRemainingThinkingMs2026
);
});
}

loadingMessage.remove();

clinicAuditAddMessage2026(
miaReply,
"bot",
false
);

if (clinicAuditQuickReplies2026) {
if (data.nextField === "clinicType") {
localStorage.removeItem(
CLINIC_AUDIT_TYPE_KNOWN_KEY_2026
);
clinicAuditQuickReplies2026.style.display =
"grid";
} else {
localStorage.setItem(
CLINIC_AUDIT_TYPE_KNOWN_KEY_2026,
"true"
);
clinicAuditQuickReplies2026.style.display =
"none";
}
}

} catch (error) {

console.error(
"Clinic audit chat error:",
error
);

loadingMessage.remove();

clinicAuditAddMessage2026(
"Small connection issue. Please try again in a moment.",
"bot",
false
);

if (
clinicAuditQuickReplies2026 &&
clinicAuditQuickRepliesWereVisible2026
) {
clinicAuditQuickReplies2026.style.display =
"grid";
}

} finally {

clinicAuditSendButton2026.disabled =
false;

clinicAuditInput2026.focus();

}

}

/* SEND BUTTON */

clinicAuditSendButton2026.addEventListener(
"click",
function(event) {

event.preventDefault();
event.stopPropagation();

clinicAuditSendMessage2026();

}
);

/* ENTER SENDS — SHIFT + ENTER ADDS A NEW LINE */

clinicAuditInput2026.addEventListener(
"keydown",
function(event) {

if (
event.key === "Enter" &&
!event.shiftKey
) {

event.preventDefault();

clinicAuditSendMessage2026();

}

}
);

/* AUTO-GROW TEXT FIELD */

clinicAuditInput2026.addEventListener(
"input",
function() {

this.style.height = "auto";

this.style.height =
Math.min(
this.scrollHeight,
120
) + "px";

}
);

/* QUICK-REPLY BUTTONS */

if (clinicAuditQuickReplies2026) {

const quickReplyButtons =
clinicAuditQuickReplies2026.querySelectorAll(
"[data-clinic-audit-reply]"
);

quickReplyButtons.forEach(
function(button) {

button.addEventListener(
"click",
function(event) {

event.preventDefault();

const quickReply =
button.getAttribute(
"data-clinic-audit-reply"
);

clinicAuditSendMessage2026(
quickReply
);

}
);

}
);

}

/* OPENAI REALTIME VOICE — AUDIT MODE ONLY */

let clinicAuditVoicePeer2026 = null;
let clinicAuditVoiceAudio2026 = null;
let clinicAuditVoiceStream2026 = null;
let clinicAuditVoiceActive2026 = false;
let clinicAuditVoiceReplyTimer2026 = null;

function clinicAuditClearVoiceReplyTimer2026() {
if (clinicAuditVoiceReplyTimer2026) {
window.clearTimeout(
clinicAuditVoiceReplyTimer2026
);
clinicAuditVoiceReplyTimer2026 = null;
}
}

function clinicAuditArmVoiceReplyTimer2026(
dataChannel
) {
clinicAuditClearVoiceReplyTimer2026();

clinicAuditVoiceReplyTimer2026 =
window.setTimeout(function() {
if (
clinicAuditVoiceActive2026 &&
dataChannel.readyState === "open"
) {
dataChannel.send(
JSON.stringify({
type: "response.create",
response: {
instructions:
"Respond to the owner's latest completed thought now. Answer any question first, then continue the Audit naturally with at most one next question."
}
})
);
}
}, 6500);
}

async function clinicAuditHandleVoiceTool2026(
realtimeEvent,
dataChannel
) {

if (
realtimeEvent.type !==
"response.function_call_arguments.done" ||
realtimeEvent.name !==
"save_clinic_audit_progress"
) {
return;
}

let auditArguments = {};

try {
auditArguments = JSON.parse(
realtimeEvent.arguments || "{}"
);
} catch (error) {
auditArguments = {};
}

try {

const response = await fetch(
CLINIC_AUDIT_VOICE_INTAKE_URL_2026,
{
method: "POST",
headers: {
"Content-Type": "application/json"
},
body: JSON.stringify({
sessionId: clinicAuditSessionId2026,
...auditArguments
})
}
);

const result = await response.json();

dataChannel.send(
JSON.stringify({
type: "conversation.item.create",
item: {
type: "function_call_output",
call_id: realtimeEvent.call_id,
output: JSON.stringify(result)
}
})
);

dataChannel.send(
JSON.stringify({
type: "response.create",
response: {
instructions:
result.instruction ||
"Continue the Clinic Revenue Audit naturally and ask only one next question."
}
})
);

} catch (error) {

console.error(
"Audit voice intake save error:",
error
);

dataChannel.send(
JSON.stringify({
type: "conversation.item.create",
item: {
type: "function_call_output",
call_id: realtimeEvent.call_id,
output: JSON.stringify({
success: false,
error: "Audit progress could not be saved."
})
}
})
);

dataChannel.send(
JSON.stringify({
type: "response.create",
response: {
instructions:
"Tell the owner briefly that the Audit progress could not be saved and ask them to continue by text chat."
}
})
);

}

}

async function clinicAuditStartVoice2026() {

if (
clinicAuditVoiceActive2026 ||
!clinicAuditVoiceButton2026
) {
return;
}

try {

clinicAuditVoiceButton2026.disabled = true;
clinicAuditVoiceButton2026.textContent =
"Connecting...";

const peer = new RTCPeerConnection();
clinicAuditVoicePeer2026 = peer;

const dataChannel =
peer.createDataChannel("oai-events");

dataChannel.addEventListener(
"message",
function(event) {

try {

const realtimeEvent =
JSON.parse(event.data);

if (
realtimeEvent.type ===
"input_audio_buffer.speech_stopped"
) {
clinicAuditArmVoiceReplyTimer2026(
dataChannel
);
}

if (
realtimeEvent.type ===
"response.created" ||
realtimeEvent.type ===
"response.done"
) {
clinicAuditClearVoiceReplyTimer2026();
}

clinicAuditHandleVoiceTool2026(
realtimeEvent,
dataChannel
);

} catch (error) {
console.error(
"Audit realtime event error:",
error
);
}

}
);

const audio = document.createElement("audio");
audio.autoplay = true;
audio.style.display = "none";
document.body.appendChild(audio);
clinicAuditVoiceAudio2026 = audio;

peer.ontrack = function(event) {
audio.srcObject = event.streams[0];
};

const localStream =
await navigator.mediaDevices.getUserMedia({
audio: true
});

clinicAuditVoiceStream2026 = localStream;

localStream.getTracks().forEach(
function(track) {
peer.addTrack(track, localStream);
}
);

const offer = await peer.createOffer();
await peer.setLocalDescription(offer);

const response = await fetch(
CLINIC_AUDIT_REALTIME_URL_2026 +
"?sessionId=" +
encodeURIComponent(
clinicAuditSessionId2026
),
{
method: "POST",
headers: {
"Content-Type": "application/sdp"
},
body: offer.sdp
}
);

if (!response.ok) {
throw new Error(
"Audit voice connection failed"
);
}

const answerSdp = await response.text();

await peer.setRemoteDescription({
type: "answer",
sdp: answerSdp
});

clinicAuditVoiceActive2026 = true;
clinicAuditVoiceButton2026.disabled = false;
clinicAuditVoiceButton2026.textContent =
"🔴 End Voice";

} catch (error) {

console.error("Audit voice error:", error);
clinicAuditStopVoice2026();

clinicAuditAddSystemMessage2026(
"Voice is unavailable right now. Please continue with Mia by text."
);

}

}

function clinicAuditStopVoice2026() {

clinicAuditClearVoiceReplyTimer2026();

if (clinicAuditVoiceStream2026) {
clinicAuditVoiceStream2026
.getTracks()
.forEach(function(track) {
track.stop();
});
clinicAuditVoiceStream2026 = null;
}

if (clinicAuditVoicePeer2026) {
clinicAuditVoicePeer2026.close();
clinicAuditVoicePeer2026 = null;
}

if (clinicAuditVoiceAudio2026) {
clinicAuditVoiceAudio2026.remove();
clinicAuditVoiceAudio2026 = null;
}

clinicAuditVoiceActive2026 = false;

if (clinicAuditVoiceButton2026) {
clinicAuditVoiceButton2026.disabled = false;
clinicAuditVoiceButton2026.textContent =
"🎙️ Talk to Mia";
}

}

if (clinicAuditVoiceButton2026) {

clinicAuditVoiceButton2026.addEventListener(
"click",
function(event) {

event.preventDefault();
event.stopPropagation();

if (clinicAuditVoiceActive2026) {
clinicAuditStopVoice2026();
} else {
clinicAuditStartVoice2026();
}

}
);

}

/* FOCUS THE FIELD WHEN THE CHAT CARD IS TAPPED */

clinicAuditRoot2026.addEventListener(
"click",
function(event) {

if (
event.target.closest(
"button"
)
) {
return;
}

if (
event.target === clinicAuditInput2026
) {
return;
}

if (
event.target.closest(
".clinic-audit-chat-messages-2026"
)
) {
return;
}

clinicAuditInput2026.focus();

}
);

})();

/* Keep the floating invitation useful without letting it cover the live chat. */
(function() {

var auditChat = document.getElementById("clinic-audit-chat-2026");
var floatingAction = document.querySelector(".audit-floating-action");

if (!auditChat || !floatingAction || !("IntersectionObserver" in window)) {
return;
}

var floatingActionObserver = new IntersectionObserver(
function(entries) {
floatingAction.classList.toggle("is-hidden", entries[0].isIntersecting);
},
{
root: null,
rootMargin: "-8% 0px -8% 0px",
threshold: 0.08
}
);

floatingActionObserver.observe(auditChat);

})();
