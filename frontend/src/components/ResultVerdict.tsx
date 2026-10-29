export function VerdictIcon({ isHotDog }: { isHotDog: boolean }) {
  return <svg className={`verdict-icon ${isHotDog ? "yes" : "no"}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {isHotDog ? <path d="m5 12 4 4L19 6" /> : <path d="m7 7 10 10M17 7 7 17" />}
  </svg>;
}

export function ResultVerdict({ isHotDog }: { isHotDog: boolean }) {
  return <div className="result-verdict">
    <div className="result-verdict-heading"><span className="result-verdict-mark"><VerdictIcon isHotDog={isHotDog} /></span><h2>{isHotDog ? "Hot dog" : "Not hot dog"}</h2></div>
    <div className="result-verdict-meta"><span>Classification complete</span><code>{String(isHotDog)}</code></div>
  </div>;
}
