export default function AltLegend() {
  const labels = ['0', '2k', '5k', '10k', '18k', '30k', '40k+'];
  return (
    <div className="alt-legend">
      <div className="alt-legend-bar" />
      <div className="alt-legend-labels">
        {labels.map(l => <span key={l} className="alt-legend-label">{l}</span>)}
      </div>
    </div>
  );
}
