import { useEffect, useRef, useState } from 'react';

import styles from '../../styles/Editor.module.css';
import EditPlanList from './EditPlanList';

export default function AIChatPanel({
  editPlan,
  setEditPlan,
  chatHistory,
  setChatHistory,
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    const userMessage = input.trim();
    if (!userMessage || busy) return;
    setError('');
    setBusy(true);
    const newHistory = [...chatHistory, { role: 'user', content: userMessage }];
    setChatHistory(newHistory);
    setInput('');

    try {
      const r = await fetch('/api/video/plan-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPlan: editPlan,
          userMessage,
          chatHistory: newHistory.slice(-10),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Plan generation failed.');
      setEditPlan(data.plan);
      const reply = data.clarifyingQuestion
        ? `${data.assistantMessage}\n\n${data.clarifyingQuestion}`
        : data.assistantMessage;
      setChatHistory([...newHistory, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveOp = (id) => {
    setEditPlan({
      ...editPlan,
      operations: editPlan.operations.filter((op) => op.id !== id),
    });
  };

  return (
    <div className={styles.chat}>
      <div className={styles.chatHeader}>◆ Edit with AI</div>

      <div ref={scrollRef} className={styles.messages}>
        {chatHistory.length === 0 && (
          <div className={`${styles.msg} ${styles.msgAssistant}`}>
            Tell me how you want to edit this video. Try: <em>“trim the first 3 seconds,” “add captions,” “make it 9:16,” “fade in over 1 second.”</em>
          </div>
        )}
        {chatHistory.map((m, i) => (
          <div
            key={i}
            className={`${styles.msg} ${m.role === 'user' ? styles.msgUser : styles.msgAssistant}`}
          >
            {m.content}
          </div>
        ))}
        {busy && <div className={`${styles.msg} ${styles.msgAssistant}`}>Thinking…</div>}
        {error && <div className={styles.msgError}>{error}</div>}
      </div>

      <form className={styles.composer} onSubmit={handleSend}>
        <input
          className={styles.composerInput}
          placeholder="Describe an edit…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className={styles.sendBtn} disabled={busy || !input.trim()}>
          Send
        </button>
      </form>

      <EditPlanList operations={editPlan.operations} onRemove={handleRemoveOp} />
    </div>
  );
}
