// Fondo líquido animado (blobs difuminados). Puro CSS, sin JS.
export default function LiquidBackground() {
  return (
    <div className="liquid-bg" aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
    </div>
  );
}
