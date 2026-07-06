// ReportPanel — the takeoff deliverable. A STACK-style breakdown by condition
// (finish): measured quantity, waste %, and waste-adjusted order quantity, with
// a grand total. Exports to CSV / JSON, prints, and hosts the opt-in
// "Contribute to the open flooring model" flow.
import React, { useState } from "react";
import { Icon } from "../brand/icons.jsx";
import { conditionTotals, grandTotals, bidTotals, totalsToCsv, downloadText, materialsSummary } from "../lib/totals.js";
import { buildContribution, sendContribution, isContributeConfigured } from "../lib/contribute.js";

const num = (v, d = 1) => (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const money = (v) => "$" + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReportPanel({ projectName, onProjectName, conditions, shapes, sheetLabel, bidSettings, onBidSettings, onUpdateCondition, onClose }) {
  const rows = conditionTotals(conditions, shapes).filter((r) => r.shape_count > 0);
  const g = grandTotals(rows);
  const bid = bidTotals(rows, bidSettings || {});
  const matSummary = materialsSummary(rows);
  const [showContribute, setShowContribute] = useState(false);

  const setBid = (patch) => onBidSettings?.({ ...(bidSettings || {}), ...patch });
  const orderQty = (r) => (r.price_unit === "LF" ? r.lf_net : r.price_unit === "EA" ? r.ea : r.total_sf_net);

  const baseName = (projectName || "takeoff").replace(/[^\w.-]+/g, "_");
  const exportCsv = () => downloadText(`${baseName}.csv`, totalsToCsv(rows, projectName, bid), "text/csv");
  const exportJson = () => downloadText(`${baseName}.json`,
    JSON.stringify({ project_name: projectName || null, generated_with: "OpenTakeoff", conditions: rows, totals: g, bid, materials: matSummary }, null, 2),
    "application/json");

  const th = { textAlign: "right", padding: "7px 10px", fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", borderBottom: "1px solid var(--ink)", whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "8px 10px", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid var(--ink-faint)", whiteSpace: "nowrap" };
  const priceInput = { width: 62, padding: "3px 5px", border: "1px solid var(--ink-faint)", borderRadius: 0, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const pctInput = { width: 48, padding: "3px 5px", border: "1px solid var(--ink-faint)", borderRadius: 0, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const bidRow = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", borderBottom: "1px solid var(--ink-faint)", fontSize: 13 };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--paper-cream)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--ink)", background: "var(--paper-bright)" }}>
        <Icon name="takeoffs" size={18} />
        <strong style={{ fontFamily: "var(--f-display)", fontSize: 16, color: "var(--ink)" }}>Takeoff report</strong>
        <input value={projectName} onChange={(e) => onProjectName(e.target.value)} placeholder="Project name (optional)"
          className="field-input" style={{ width: 260, padding: "5px 9px", fontSize: 13 }} />
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={exportCsv} disabled={!rows.length}><Icon name="document" size={13} />CSV</button>
        <button className="btn-ghost" onClick={exportJson} disabled={!rows.length}><Icon name="document" size={13} />JSON</button>
        <button className="btn-ghost" onClick={() => window.print()} disabled={!rows.length}>Print</button>
        <button className="btn-primary" onClick={() => setShowContribute(true)} disabled={!rows.length}
          title="Optionally contribute this takeoff's derived data to the open flooring model">
          <Icon name="oneClick" size={13} />Contribute
        </button>
        <button onClick={onClose} title="Back to the canvas (Esc)"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12.5 }}>
          <Icon name="close" size={12} />Close
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {!rows.length ? (
          <div style={{ padding: 48, textAlign: "center", color: "var(--ink-muted)" }}>
            Nothing measured yet — trace some areas, then come back for the breakdown.
          </div>
        ) : (
          <table style={{ width: "100%", maxWidth: 980, margin: "0 auto", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Finish</th>
                <th style={th}>Shapes</th>
                <th style={th}>Floor SF</th>
                <th style={th}>Wall SF</th>
                <th style={th}>Border SF</th>
                <th style={th}>LF</th>
                <th style={th}>EA</th>
                <th style={th}>Waste</th>
                <th style={{ ...th, color: "var(--cobalt)" }}>SF ordered</th>
                <th style={{ ...th, color: "var(--cobalt)" }}>SY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, textAlign: "left" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 12, height: 12, background: r.color, display: "inline-block", border: "1px solid var(--ink-faint)" }} />
                      <strong style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>{r.finish_tag}</strong>
                      {r.multiplier > 1 && <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>×{r.multiplier}</span>}
                    </span>
                  </td>
                  <td style={td}>{r.shape_count}</td>
                  <td style={td}>{r.floor_sf ? num(r.floor_sf) : "—"}</td>
                  <td style={td}>{r.wall_sf ? num(r.wall_sf) : "—"}</td>
                  <td style={td}>{r.border_sf ? num(r.border_sf) : "—"}</td>
                  <td style={td}>{r.lf ? num(r.lf) : "—"}</td>
                  <td style={td}>{r.ea ? num(r.ea, 0) : "—"}</td>
                  <td style={td}>{r.waste_pct ? `${num(r.waste_pct, 0)}%` : "—"}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--cobalt)" }}>{r.total_sf ? num(r.total_sf_net) : "—"}</td>
                  <td style={{ ...td, color: "var(--cobalt)" }}>{r.total_sf ? num(r.sy_net) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, textAlign: "left", borderTop: "2px solid var(--ink)", fontWeight: 700 }}>Total</td>
                <td style={{ ...td, borderTop: "2px solid var(--ink)" }} colSpan={6}></td>
                <td style={{ ...td, borderTop: "2px solid var(--ink)" }}></td>
                <td style={{ ...td, borderTop: "2px solid var(--ink)", fontWeight: 700, color: "var(--cobalt)" }}>{num(g.total_sf_net)}</td>
                <td style={{ ...td, borderTop: "2px solid var(--ink)", color: "var(--cobalt)" }}>{num(g.sy_net)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {rows.length > 0 && (
          <p style={{ maxWidth: 980, margin: "14px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
            <strong>SF ordered</strong> = measured quantity × waste %. Waste is set per condition in the canvas. Wall SF comes from Surface-Area
            traces (run × height); Border SF from Linear runs with a thickness.
          </p>
        )}
        {rows.length > 0 && (
          <div style={{ maxWidth: 980, margin: "28px auto 0" }}>
            <h3 style={{ fontFamily: "var(--f-display)", fontSize: 14, color: "var(--ink)", margin: "0 0 8px" }}>Pricing &amp; bid</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Finish</th>
                  <th style={th}>Order qty</th>
                  <th style={th}>Unit</th>
                  <th style={th}>Material $/unit</th>
                  <th style={th}>Labor $/unit</th>
                  <th style={th}>Material $</th>
                  <th style={th}>Labor $</th>
                  <th style={{ ...th, color: "var(--cobalt)" }}>Line total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 12, height: 12, background: r.color, display: "inline-block", border: "1px solid var(--ink-faint)" }} />
                        <strong style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>{r.finish_tag}</strong>
                      </span>
                    </td>
                    <td style={td}>{r.price_unit ? num(orderQty(r)) : "—"}</td>
                    <td style={{ ...td, color: "var(--ink-muted)" }}>{r.price_unit || "—"}</td>
                    <td style={td}>
                      <span style={{ color: "var(--ink-muted)" }}>$</span>
                      <input type="number" min="0" step="0.01" value={r.price_material || ""} placeholder="0.00"
                        onChange={(e) => onUpdateCondition?.(r.id, { price_material: Math.max(0, Number(e.target.value) || 0) })}
                        style={priceInput} />
                    </td>
                    <td style={td}>
                      <span style={{ color: "var(--ink-muted)" }}>$</span>
                      <input type="number" min="0" step="0.01" value={r.price_labor || ""} placeholder="0.00"
                        onChange={(e) => onUpdateCondition?.(r.id, { price_labor: Math.max(0, Number(e.target.value) || 0) })}
                        style={priceInput} />
                    </td>
                    <td style={td}>{r.material_cost ? money(r.material_cost) : "—"}</td>
                    <td style={td}>{r.labor_cost ? money(r.labor_cost) : "—"}</td>
                    <td style={{ ...td, fontWeight: 700, color: "var(--cobalt)" }}>{r.line_total ? money(r.line_total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <div style={{ width: 360, background: "var(--paper-bright)", border: "1px solid var(--ink)" }}>
                {[["Material subtotal", money(bid.material_subtotal)], ["Labor subtotal", money(bid.labor_subtotal)], ["Cost subtotal", money(bid.cost_subtotal)]].map(([k, v]) => (
                  <div key={k} style={bidRow}><span style={{ color: "var(--ink-muted)" }}>{k}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span></div>
                ))}
                <div style={bidRow}>
                  <span style={{ color: "var(--ink-muted)" }}>Sales tax (on material)</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min="0" step="0.1" value={(bidSettings?.tax_pct) || ""} placeholder="0"
                      onChange={(e) => setBid({ tax_pct: Math.max(0, Number(e.target.value) || 0) })} style={pctInput} />%
                    <span style={{ width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(bid.tax)}</span>
                  </span>
                </div>
                <div style={bidRow}>
                  <span style={{ color: "var(--ink-muted)" }}>Overhead (on cost)</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min="0" step="0.1" value={(bidSettings?.overhead_pct) || ""} placeholder="0"
                      onChange={(e) => setBid({ overhead_pct: Math.max(0, Number(e.target.value) || 0) })} style={pctInput} />%
                    <span style={{ width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(bid.overhead)}</span>
                  </span>
                </div>
                <div style={bidRow}>
                  <span style={{ color: "var(--ink-muted)" }}>Profit / margin</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min="0" step="0.1" value={(bidSettings?.profit_pct) || ""} placeholder="0"
                      onChange={(e) => setBid({ profit_pct: Math.max(0, Number(e.target.value) || 0) })} style={pctInput} />%
                    <span style={{ width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(bid.profit)}</span>
                  </span>
                </div>
                <div style={{ ...bidRow, borderTop: "2px solid var(--ink)", borderBottom: "none", background: "var(--paper-cream)" }}>
                  <strong style={{ fontFamily: "var(--f-display)", fontSize: 15 }}>Bid total</strong>
                  <strong style={{ fontFamily: "var(--f-display)", fontSize: 16, color: "var(--cobalt)", fontVariantNumeric: "tabular-nums" }}>{money(bid.bid_total)}</strong>
                </div>
              </div>
            </div>
            <p style={{ margin: "10px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
              Enter a unit price per finish (blank = untracked). Material prices the <strong>order quantity</strong> (waste included); labor prices the measured quantity. Tax applies to material, overhead to total cost, profit marks up the rest.
            </p>
          </div>
        )}
        {matSummary.length > 0 && (
          <div style={{ maxWidth: 980, margin: "26px auto 0" }}>
            <h3 style={{ fontFamily: "var(--f-display)", fontSize: 14, color: "var(--ink)", margin: "0 0 8px" }}>Supporting materials — buy list</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Material</th>
                  <th style={th}>Quantity</th>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 16 }}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {matSummary.map((m, i) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left" }}>{m.name}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{num(m.qty, 2)}</td>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 16, color: "var(--ink-muted)" }}>{m.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ maxWidth: 980, margin: "10px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.7 }}>
              <strong>By finish:</strong>{" "}
              {rows.filter((r) => r.materials?.length).map((r) => (
                <span key={r.id} style={{ marginRight: 14, whiteSpace: "nowrap" }}>
                  <strong style={{ fontFamily: "var(--f-mono)" }}>{r.finish_tag}</strong>{" "}
                  {r.materials.map((m) => `${m.name} ${num(m.qty, 2)}${m.unit ? " " + m.unit : ""}${m.note ? ` (${m.note})` : ""}`).join(" · ")}
                </span>
              ))}
              <br />Each quantity = measured {`{area / linear / count}`} ÷ your coverage rate, rounded up to whole units.
            </p>
          </div>
        )}
      </div>

      {showContribute && (
        <ContributeModal conditions={conditions} shapes={shapes} onClose={() => setShowContribute(false)} />
      )}
    </div>
  );
}

function ContributeModal({ conditions, shapes, onClose }) {
  const [attest, setAttest] = useState(false);
  const [contributor, setContributor] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [msg, setMsg] = useState("");
  const configured = isContributeConfigured();

  const send = async () => {
    if (!attest || !configured) return;
    setState("sending"); setMsg("");
    try {
      await sendContribution(buildContribution({ conditions, shapes }), contributor.trim());
      setState("done"); setMsg("Thank you — your takeoff is now helping train the open flooring model.");
    } catch (e) {
      setState("error"); setMsg(e.message || String(e));
    }
  };

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(14,26,46,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 520, maxWidth: "100%", maxHeight: "90%", overflow: "auto", background: "var(--paper-bright)", boxShadow: "var(--shadow-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--ink)" }}>
          <Icon name="oneClick" size={16} />
          <strong style={{ fontFamily: "var(--f-display)", fontSize: 15 }}>Contribute to the open flooring model</strong>
        </div>
        <div style={{ padding: "16px", fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>
          <p style={{ marginTop: 0 }}>Help grow a shared, flooring-tuned open model. We send only the <strong>derived takeoff</strong>:</p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            <li>condition labels, shape types, and quantities (SF / LF / EA)</li>
            <li>normalized room geometry (shape only — no scale, no location)</li>
          </ul>
          <p style={{ margin: "0 0 10px", color: "var(--c-positive)", fontWeight: 600 }}>
            Never sent: the PDF itself, file names, project or client names, your markups, or any absolute coordinates.
          </p>
          {!configured && (
            <p style={{ background: "var(--paper-shadow)", padding: "8px 10px", fontSize: 12.5, color: "var(--ink)" }}>
              This build has no contribution endpoint configured, so nothing can be sent. (Set <code>VITE_CONTRIBUTE_ENDPOINT</code> at build time, or
              <code> localStorage.opentakeoff_contribute_endpoint</code> in your browser.)
            </p>
          )}
          <label style={{ display: "block", margin: "6px 0" }}>
            <span className="field-label">Credit (optional)</span>
            <input value={contributor} onChange={(e) => setContributor(e.target.value)} placeholder="Name or company to credit"
              className="field-input" style={{ marginTop: 4 }} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I have the right to share this takeoff data and am contributing it to the open flooring model.</span>
          </label>
          {msg && <p style={{ fontSize: 12.5, color: state === "error" ? "var(--c-danger)" : "var(--c-positive)" }}>{msg}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid var(--ink-faint)" }}>
          <button className="btn-ghost" onClick={onClose}>{state === "done" ? "Close" : "Cancel"}</button>
          <button className="btn-primary" onClick={send} disabled={!attest || !configured || state === "sending" || state === "done"}>
            {state === "sending" ? "Sending…" : "Contribute"}
          </button>
        </div>
      </div>
    </div>
  );
}
