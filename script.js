/* ============================================================
   TM SIMULATOR — SCRIPT.JS
   Handles: Automaton parsing, TM conversion, simulation,
            step-limited execution, halting analysis
   ============================================================ */

"use strict";

// ──────────────────────────────────────────────────────────────
//  GLOBAL STATE
// ──────────────────────────────────────────────────────────────
let automaton = null;       // Parsed automaton definition
let tm = null;              // Generated Turing Machine
let simState = null;        // Current simulation state

// ──────────────────────────────────────────────────────────────
//  UTILITY
// ──────────────────────────────────────────────────────────────
function parseList(str) {
  return str.split(',').map(s => s.trim()).filter(Boolean);
}
function el(id) { return document.getElementById(id); }
function show(id) { el(id).classList.remove('hidden'); }
function hide(id) { el(id).classList.add('hidden'); }

// ──────────────────────────────────────────────────────────────
//  AUTOMATON TYPE SELECTION
// ──────────────────────────────────────────────────────────────
const DFA_DESC = '<strong>Deterministic Finite Automaton (DFA):</strong> Each state has exactly one transition per input symbol. Converted to a TM that reads and moves right, halting upon acceptance or rejection.';
const NFA_DESC = '<strong>Non-Deterministic Finite Automaton (NFA):</strong> A state may have multiple transitions for the same symbol (or ε-transitions). Converted by subset construction into an equivalent DFA, then to a TM.';

function selectType(type) {
  el('btn-dfa').classList.toggle('active', type === 'dfa');
  el('btn-nfa').classList.toggle('active', type === 'nfa');
  el('type-desc').innerHTML = type === 'dfa' ? DFA_DESC : NFA_DESC;

  const hint = el('inp-transitions').nextElementSibling;
  if (type === 'nfa') {
    el('inp-transitions').value = 'q0, 0 → q0|q1\nq0, 1 → q0\nq1, 0 → q2\nq1, 1 → q2\nq2, 0 → q2\nq2, 1 → q2';
  } else {
    el('inp-transitions').value = 'q0, 0 → q1\nq0, 1 → q0\nq1, 0 → q1\nq1, 1 → q2\nq2, 0 → q2\nq2, 1 → q2';
  }
}

// ──────────────────────────────────────────────────────────────
//  LOAD EXAMPLE
// ──────────────────────────────────────────────────────────────
function loadExample() {
  el('inp-states').value   = 'q0, q1, q2';
  el('inp-alphabet').value = '0, 1';
  el('inp-start').value    = 'q0';
  el('inp-accept').value   = 'q2';
  el('inp-transitions').value =
    'q0, 0 → q1\nq0, 1 → q0\nq1, 0 → q1\nq1, 1 → q2\nq2, 0 → q2\nq2, 1 → q2';
  el('inp-string').value   = '011';
  selectType('dfa');
  resetSimulation();
  showToast('✅ Example loaded — DFA that accepts strings containing "01"');
}

// ──────────────────────────────────────────────────────────────
//  LOAD LOOP EXAMPLE  (demonstrates step-limit / ⚠ case)
// ──────────────────────────────────────────────────────────────
function loadLoopExample() {
  // True two-state cycle: q0 → q1 → q0 → q1 …
  // No accept states → TM never reaches q_accept or q_reject naturally.
  // Blank bounce (added by buildTuringMachine) keeps head oscillating.
  // Step-limit fires the ⚠ LOOP case.
  el('inp-states').value   = 'q0, q1';
  el('inp-alphabet').value = '0, 1';
  el('inp-start').value    = 'q0';
  el('inp-accept').value   = '';              // ← NO accept states
  el('inp-transitions').value =
    'q0, 0 → q1\nq0, 1 → q1\nq1, 0 → q0\nq1, 1 → q0';  // ← real cycle
  el('inp-string').value   = '01';
  el('inp-steps').value    = '12';            // low limit — loop fires fast
  selectType('dfa');
  resetSimulation();
  parseAutomaton();
  showToast('⚠ Loop loaded — machine cycles q0 ↔ q1 forever. Click Run!');
}

// ──────────────────────────────────────────────────────────────
//  VALIDATE DFA COMPLETENESS
//  Returns array of missing (state, symbol) pairs
// ──────────────────────────────────────────────────────────────
function validateDFA(delta, states, alphabet) {
  const missing = [];
  for (const state of states) {
    for (const sym of alphabet) {
      const nexts = delta[state] && delta[state][sym];
      if (!nexts || nexts.length === 0) {
        missing.push({ state, sym });
      }
    }
  }
  return missing;
}

// Render validation result panel inside the converter card
function renderValidationResult(missing, states, alphabet, isNFA) {
  // Remove old panel if present
  const old = document.getElementById('validation-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'validation-panel';

  if (missing.length === 0) {
    panel.className = 'validation-panel valid';
    panel.innerHTML =
      '<span class="val-icon">✔</span>' +
      `<div><strong>Complete ${isNFA ? 'NFA' : 'DFA'}</strong> — All ${states.length} × ${alphabet.length} = ${states.length * alphabet.length} transitions are defined. No missing entries.</div>`;
  } else {
    panel.className = 'validation-panel incomplete';
    const pills = missing.map(m =>
      `<span class="miss-pill">(${m.state}, ${m.sym})</span>`
    ).join('');
    panel.innerHTML =
      '<span class="val-icon">⚠</span>' +
      `<div>` +
        `<strong>Incomplete DFA — ${missing.length} missing transition(s)</strong><br/>` +
        `<span class="val-sub">Missing: </span>${pills}<br/>` +
        `<span class="val-hint">Tip: Add these transitions or the TM will reject any path that reaches them.</span>` +
      `</div>`;
  }

  // Insert after the textarea
  const transArea = el('inp-transitions');
  transArea.parentElement.parentElement.appendChild(panel);
}

// ──────────────────────────────────────────────────────────────
//  PARSE AUTOMATON & CONVERT TO TM
// ──────────────────────────────────────────────────────────────
function parseAutomaton() {
  const states   = parseList(el('inp-states').value);
  const alphabet = parseList(el('inp-alphabet').value);
  const start    = el('inp-start').value.trim();
  const accepts  = parseList(el('inp-accept').value);
  const rawTrans = el('inp-transitions').value.trim();
  const isNFA    = el('btn-nfa').classList.contains('active');

  if (!states.length || !alphabet.length || !start) {
    showToast('⚠ Please fill in all required fields.', 'warn');
    return;
  }
  if (!states.includes(start)) {
    showToast('⚠ Start state must be one of the defined states.', 'warn');
    return;
  }

  // Parse transitions
  const delta = {}; // delta[state][symbol] = [nextStates]
  for (const state of states) { delta[state] = {}; }

  const transLines = rawTrans.split('\n').filter(Boolean);
  for (const line of transLines) {
    // Format: "q0, 0 → q1" or "q0, 0 → q0|q1"
    const match = line.match(/^(\w+)\s*,\s*(\S+)\s*[→>-]+\s*(.+)$/);
    if (!match) { showToast(`⚠ Invalid transition: "${line}"`, 'warn'); return; }
    const [, from, rawSym, toRaw] = match;
    // ✅ FIX 2 — trim symbol so "_ " and "_" are treated identically
    const sym = rawSym.trim();
    const toStates = toRaw.split('|').map(s => s.trim()).filter(Boolean);
    if (!delta[from]) delta[from] = {};
    delta[from][sym] = toStates;
  }

  // ★ VALIDATE completeness and render panel
  const missingTransitions = validateDFA(delta, states, alphabet);
  renderValidationResult(missingTransitions, states, alphabet, isNFA);

  automaton = { states, alphabet, start, accepts, delta, isNFA };

  // Convert to TM
  tm = buildTuringMachine(automaton);

  // Display TM definition
  renderTMDefinition(tm);
  show('conversion-result');

  // Scroll to result
  el('conversion-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast('🎉 Turing Machine generated successfully!');
}

// ──────────────────────────────────────────────────────────────
//  BUILD TURING MACHINE FROM AUTOMATON
// ──────────────────────────────────────────────────────────────
function buildTuringMachine(a) {
  // TM Formal Definition (7-tuple):
  //   States : Q ∪ {q_accept, q_reject}
  //   Tape Σ : Σ ∪ {_}  (blank = _)
  //
  // KEY RULE for loop support:
  //   • Explicit transitions  → follow them (may loop forever if they cycle)
  //   • Missing transition    → q_reject  (halts)
  //   • Blank on a NON-accept state that still has explicit symbol transitions
  //     → do NOT add a forced q_reject on blank; leave the gap so the step
  //       limit (not an immediate halt) governs non-termination detection.
  //   • Blank on a state with NO explicit non-blank transitions → q_reject
  const tmStates  = [...a.states, 'q_accept', 'q_reject'];
  const tapeAlpha = [...a.alphabet, '_'];
  const transitions = []; // { from, read, to, write, dir }
  const hasAccepts = a.accepts.length > 0;

  for (const state of a.states) {
    const stateHasAnyTrans = a.alphabet.some(
      sym => (a.delta[state] && a.delta[state][sym] && a.delta[state][sym].length > 0)
    );

    for (const sym of a.alphabet) {
      const nexts = (a.delta[state] && a.delta[state][sym]) || [];
      if (nexts.length > 0) {
        // Determine destination: if next state is in accept set → q_accept
        const dest = (hasAccepts && a.accepts.includes(nexts[0]))
          ? 'q_accept'
          : nexts[0];
        transitions.push({ from: state, read: sym, to: dest, write: sym, dir: 'R', fromMissing: false });
      } else {
        // No explicit transition → synthesised reject (marks incomplete DFA)
        transitions.push({ from: state, read: sym, to: 'q_reject', write: sym, dir: 'R', fromMissing: true });
      }
    }

    // Blank symbol handling:
    const isAcceptState = hasAccepts && a.accepts.includes(state);
    if (isAcceptState) {
      // Reached end of tape in an accept state → ACCEPT
      transitions.push({ from: state, read: '_', to: 'q_accept', write: '_', dir: 'R' });
    } else if (stateHasAnyTrans && !hasAccepts) {
      // ✅ Looping TM: bounce head LEFT on blank so it never falls off the
      // tape end. This guarantees the step-limit fires the ⚠ LOOP case
      // instead of a premature blank-triggered REJECT.
      transitions.push({ from: state, read: '_', to: state, write: '_', dir: 'L' });
    } else {
      // Normal reject on blank
      transitions.push({ from: state, read: '_', to: 'q_reject', write: '_', dir: 'R' });
    }
  }

  return {
    states: tmStates,
    inputAlphabet: a.alphabet,
    tapeAlphabet: tapeAlpha,
    start: a.start,
    acceptState: 'q_accept',
    rejectState: 'q_reject',
    transitions,
    originalAccepts: a.accepts,
    isLoopingTM: !hasAccepts   // flag: no accept states → designed to loop
  };
}

// ──────────────────────────────────────────────────────────────
//  RENDER TM DEFINITION (FORMATTED)
// ──────────────────────────────────────────────────────────────
function renderTMDefinition(t) {
  const fmt = (arr) => '{ ' + arr.join(', ') + ' }';
  const lines = [
    `<span class="comment">// Formal Turing Machine Definition (7-tuple)</span>`,
    ``,
    `<span class="kw">M</span> = (Q, Σ, Γ, δ, q₀, q_accept, q_reject)`,
    ``,
    `<span class="kw">Q</span>           = <span class="val">${fmt(t.states)}</span>`,
    `<span class="kw">Σ</span> (input)    = <span class="val">${fmt(t.inputAlphabet)}</span>`,
    `<span class="kw">Γ</span> (tape)     = <span class="val">${fmt(t.tapeAlphabet)}</span>`,
    `<span class="kw">q₀</span> (start)   = <span class="val">${t.start}</span>`,
    `<span class="kw">q_accept</span>    = <span class="val">${t.acceptState}</span>`,
    `<span class="kw">q_reject</span>    = <span class="val">${t.rejectState}</span>`,
    ``,
    `<span class="comment">// Transition Function δ: Q × Γ → Q × Γ × {L, R}</span>`,
    `<span class="kw">δ</span>(state, read) <span class="arrow">→</span> (next_state, write, direction)`,
    ``,
    ...t.transitions.map(tr =>
      `  δ(<span class="val">${tr.from}</span>, <span class="arrow">${tr.read}</span>) <span class="arrow">→</span> (<span class="val">${tr.to}</span>, ${tr.write}, ${tr.dir})`
    )
  ];
  el('tm-definition').innerHTML = lines.join('\n');
}

// ──────────────────────────────────────────────────────────────
//  SIMULATOR
// ──────────────────────────────────────────────────────────────
function goToSimulator() {
  el('simulator').scrollIntoView({ behavior: 'smooth' });
  el('nav-simulator').classList.add('active');
  el('nav-converter').classList.remove('active');
}

function resetSimulation() {
  simState = null;
  el('step-log').innerHTML = '<div class="log-placeholder">Run the simulation to see the step-by-step execution log...</div>';
  el('step-counter').textContent = 'Step 0';
  el('curr-state').textContent = '—';
  el('head-pos').textContent  = '—';
  el('direction').textContent = '—';
  el('tape-display').innerHTML = '';
  el('result-card').classList.add('hidden');
  el('result-card').className = 'result-card hidden';
  drawStateCanvas(null);
}

function initSimState(inputStr) {
  const tape = inputStr.length ? inputStr.split('') : ['_'];
  const paddedTape = ['_', '_', ...tape, '_', '_'];
  const headStart  = 2;

  const base = {
    tape: paddedTape,
    head: headStart,
    step: 0,
    log: [],
    done: false,
    result: null
  };

  if (automaton && automaton.isNFA) {
    // NFA mode: track a SET of active states (subset construction)
    base.currentStates = new Set([automaton.start]);
    base.inputSymbols  = inputStr.split('');  // process one symbol per step
    base.symIndex      = 0;                   // which symbol we are on
    base.state         = automaton.start;     // canonical label for canvas
    base.mode          = 'nfa';
  } else {
    // DFA / TM mode: single current state
    base.state = tm.start;
    base.mode  = 'dfa';
  }

  return base;
}

// Run full simulation (auto-step with animation)
let simTimer = null;
function runSimulation() {
  if (!tm) {
    showToast('⚠ Please convert an automaton first!', 'warn');
    el('converter').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  resetSimulation();

  const inputStr = el('inp-string').value.trim();
  const maxSteps = parseInt(el('inp-steps').value) || 100;

  simState = initSimState(inputStr);
  simState._maxSteps = maxSteps;   // ★ store limit in state so executeStep can see it

  // Run steps with animation delay
  clearInterval(simTimer);
  el('btn-run').disabled = true;
  el('btn-step').disabled = true;

  simTimer = setInterval(() => {
    if (simState.done) {
      clearInterval(simTimer);
      el('btn-run').disabled = false;
      el('btn-step').disabled = false;
      finalizeResult(simState.result, maxSteps);
      return;
    }
    executeStep(simState);
    renderTape(simState);
    renderStateInfo(simState);

    if (simState.done) {
      clearInterval(simTimer);
      el('btn-run').disabled = false;
      el('btn-step').disabled = false;
      finalizeResult(simState.result, maxSteps);
    }
  }, 220);
}

// Step-by-step mode
function stepSimulation() {
  if (!tm) {
    showToast('⚠ Please convert an automaton first!', 'warn');
    el('converter').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (!simState) {
    const inputStr = el('inp-string').value.trim();
    const maxSteps = parseInt(el('inp-steps').value) || 100;
    simState = initSimState(inputStr);
    simState._maxSteps = maxSteps;   // ★ always persist the limit
    el('result-card').classList.add('hidden');
  }

  if (simState.done) {
    showToast('Simulation already complete. Reset to run again.');
    return;
  }

  const maxSteps = simState._maxSteps;
  executeStep(simState);   // step-limit now checked INSIDE executeStep
  renderTape(simState);
  renderStateInfo(simState);

  if (simState.done) {
    finalizeResult(simState.result, maxSteps);
  }
}

// ──────────────────────────────────────────────────────────────
//  NFA HELPERS — subset construction simulation
// ──────────────────────────────────────────────────────────────

/**
 * Given a set of active NFA states and an input symbol,
 * return the union of all states reachable via delta.
 */
function getNextStates(activeStates, symbol) {
  const next = new Set();
  activeStates.forEach(state => {
    const nexts = (automaton.delta[state] && automaton.delta[state][symbol]) || [];
    nexts.forEach(s => next.add(s));
  });
  return next;
}

/**
 * One step of the NFA subset-construction simulation.
 * Consumes one input symbol; updates s.currentStates.
 */
function nfaStep(s) {
  s.step++;

  // Step-limit guard (same as DFA)
  if (s.step >= s._maxSteps) {
    s.done = true; s.result = 'loop';
    addLog(s,
      `<span class="log-step">[${s.step}]</span>` +
      ` <span class="log-loop">⚠ STEP LIMIT REACHED — execution stopped.</span>`,
      'log-loop'
    );
    return;
  }

  // If all input symbols consumed → check acceptance
  if (s.symIndex >= s.inputSymbols.length) {
    const accepted = [...s.currentStates].some(st => automaton.accepts.includes(st));
    s.done   = true;
    s.result = accepted ? 'accept' : 'reject';
    if (accepted) {
      const acceptingOnes = [...s.currentStates].filter(st => automaton.accepts.includes(st));
      addLog(s,
        `✅ Input consumed. Active accept states: {${acceptingOnes.join(', ')}} → ACCEPTED`,
        'log-accept'
      );
    } else {
      s.rejectReason = { type: 'explicit_reject', state: [...s.currentStates].join('|'), symbol: '(end)' };
      addLog(s,
        `❌ Input consumed. No active accept state in {${[...s.currentStates].join(', ')}} → REJECTED`,
        'log-reject'
      );
    }
    return;
  }

  const sym  = s.inputSymbols[s.symIndex];
  const prev = new Set(s.currentStates);
  const next = getNextStates(s.currentStates, sym);

  // Log the subset step
  const prevLabel = `{${[...prev].join(', ')}}`;
  const nextLabel = next.size ? `{${[...next].join(', ')}}` : '∅ (dead)';

  addLog(s,
    `<span class="log-step">[${s.step}]</span>` +
    ` Read: <span class="log-read">${sym}</span>` +
    ` | Active: <span class="log-state">${prevLabel}</span>` +
    ` | Next: <span class="log-state">${next.size ? nextLabel : '<span class="log-loop">∅ dead — REJECT</span>'}</span>`
  );

  s.symIndex++;
  s.currentStates = next;

  // Update canonical state label (for canvas/pills — show first active state)
  s.state = next.size ? [...next][0] : 'dead';
  s.lastDir  = 'R';
  s.lastRead = sym;

  // Update tape head position to match symbol read
  s.head = 2 + s.symIndex;  // skip 2 leading blanks; point after consumed symbol

  // If state set is empty → dead configuration → reject immediately
  if (next.size === 0) {
    s.done = true; s.result = 'reject';
    s.rejectReason = {
      type: 'missing_transition',
      state: [...prev].join('|'),
      symbol: sym
    };
    addLog(s, `❌ Dead state reached — no transitions from ${prevLabel} on '${sym}' → REJECTED`, 'log-reject');
  }
}

// ──────────────────────────────────────────────────────────────
//  CORE SIMULATION STEP (DFA / TM path)
//
//  Execution order:
//    1. Increment step counter
//    2. ★ CHECK STEP LIMIT FIRST — triggers ⚠ loop case
//    3. Expand tape boundaries
//    4. If already in q_accept / q_reject → finalise HALT
//    5. Look up transition
//    6. If no transition → REJECT (halts)
//    7. Apply transition, move head
//    8. If new state is q_accept / q_reject → finalise HALT
// ──────────────────────────────────────────────────────────────
function executeStep(s) {
  // ★ Branch: NFA gets its own subset-construction stepping logic
  if (s.mode === 'nfa') { nfaStep(s); return; }
  // ★ STEP 1 — increment BEFORE any halt check
  s.step++;

  // ★ STEP 2 — step-limit check FIRST (most important fix)
  //   This fires the ⚠ approximate-solution path for looping TMs.
  if (s.step >= s._maxSteps) {
    s.done   = true;
    s.result = 'loop';
    addLog(s,
      `<span class="log-step">[${s.step}]</span>` +
      ` <span class="log-loop">⚠ STEP LIMIT REACHED — execution stopped.</span>`,
      'log-loop'
    );
    return;
  }

  // STEP 3 — expand tape
  while (s.head < 0)              { s.tape.unshift('_'); s.head++; }
  while (s.head >= s.tape.length) { s.tape.push('_'); }

  // ✅ FIX 1 — blank cell (undefined / empty string) becomes '_'
  // ✅ FIX 2 — trim whitespace so " _ " matches stored transitions
  const read  = (s.tape[s.head] || '_').trim();
  const state = s.state;

  // ✅ FIX 4 — debug log (remove after verification)
  console.log(`[TM] Step ${s.step} | State: ${state} | Reading symbol: "${read}"`);


  // STEP 4 — already in a halt state (shouldn't normally get here, safety net)
  if (state === tm.acceptState) {
    s.done = true; s.result = 'accept';
    addLog(s, `✅ HALTED — Machine is in ${state}. String ACCEPTED.`, 'log-accept');
    return;
  }
  if (state === tm.rejectState) {
    s.done = true; s.result = 'reject';
    addLog(s, `❌ HALTED — Machine is in ${state}. String REJECTED.`, 'log-reject');
    return;
  }

  // STEP 5 — look up transition
  // ✅ FIX 3 — trim both sides so whitespace never blocks a match
  const trans = tm.transitions.find(
    t => t.from.trim() === state.trim() && t.read.trim() === read
  );

  // STEP 6 — no transition → halt+reject (store exact reason for analysis panel)
  if (!trans) {
    s.done = true; s.result = 'reject';
    // ★ No TM transition at all — this path should be unreachable after buildTuringMachine
    s.rejectReason = { state, symbol: read, type: 'missing_transition' };
    addLog(s, `❌ No transition for (${state}, ${read === '_' ? '␣' : read}) → REJECTED (missing transition)`, 'log-reject');
    return;
  }

  // STEP 7 — log and apply transition
  addLog(s,
    `<span class="log-step">[${s.step}]</span>` +
    ` State: <span class="log-state">${trans.from}</span>` +
    ` | Read: <span class="log-read">${trans.read === '_' ? '␣' : trans.read}</span>` +
    ` | Write: ${trans.write === '_' ? '␣' : trans.write}` +
    ` | Move: <span class="log-move">${trans.dir}</span>` +
    ` | Next: <span class="log-state">${trans.to}</span>` +
    (trans.fromMissing ? ` <span class="log-loop">[missing in automaton]</span>` : '')
  );

  s.tape[s.head] = trans.write;
  s.state        = trans.to;
  s.lastDir      = trans.dir;
  s.lastRead     = trans.read;

  if (trans.dir === 'R') s.head++;
  else if (trans.dir === 'L') s.head--;

  // STEP 8 — post-transition halt check
  if (s.state === tm.acceptState) {
    s.done = true; s.result = 'accept';
    addLog(s, `✅ HALTED — Reached ${tm.acceptState}. String ACCEPTED.`, 'log-accept');
  } else if (s.state === tm.rejectState) {
    s.done = true; s.result = 'reject';
    // ★ Distinguish missing-transition reject from explicit reject
    if (trans.fromMissing) {
      s.rejectReason = {
        state: trans.from,
        symbol: trans.read,
        type: 'missing_transition'
      };
    } else {
      s.rejectReason = {
        state: trans.from,
        symbol: trans.read,
        type: 'explicit_reject',
        via: trans.from
      };
    }
    addLog(s, `❌ HALTED — Reached ${tm.rejectState}. String REJECTED.`, 'log-reject');
  }
}

function addLog(s, msg, cls = 'log-entry') {
  s.log.push({ msg, cls });
  const logBox = el('step-log');
  // Remove placeholder
  const ph = logBox.querySelector('.log-placeholder');
  if (ph) ph.remove();

  const div = document.createElement('div');
  div.className = `log-entry ${cls}`;
  div.innerHTML = msg;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// ──────────────────────────────────────────────────────────────
//  RENDER TAPE
// ──────────────────────────────────────────────────────────────
function renderTape(s) {
  const track = el('tape-display');
  track.innerHTML = '';

  // Show window of tape around head
  const start = Math.max(0, s.head - 6);
  const end   = Math.min(s.tape.length - 1, s.head + 6);

  for (let i = start; i <= end; i++) {
    const cell = document.createElement('div');
    cell.className = 'tape-cell';

    const sym = s.tape[i] || '_';

    if (i === s.head) {
      cell.classList.add('head');
      if (s.done && s.result === 'accept') cell.classList.add('accept');
      if (s.done && s.result === 'reject') cell.classList.add('reject');
    }
    if (sym === '_') cell.classList.add('blank');

    cell.textContent = sym === '_' ? '␣' : sym;
    track.appendChild(cell);
  }

  el('step-counter').textContent = `Step ${s.step}`;
}

// ──────────────────────────────────────────────────────────────
//  RENDER STATE INFO PILLS
// ──────────────────────────────────────────────────────────────
function renderStateInfo(s) {
  if (s.mode === 'nfa' && s.currentStates) {
    const setLabel = s.currentStates.size
      ? `{${[...s.currentStates].join(', ')}}`
      : '∅ (dead)';
    el('curr-state').textContent = setLabel;
    el('head-pos').textContent   = s.symIndex !== undefined ? s.symIndex : s.head;
    el('direction').textContent  = 'R';
  } else {
    el('curr-state').textContent = s.state;
    el('head-pos').textContent   = s.head;
    el('direction').textContent  = s.lastDir || '—';
  }
  drawStateCanvas(s);
}

// ──────────────────────────────────────────────────────────────
//  DRAW STATE TRANSITION CANVAS
// ──────────────────────────────────────────────────────────────
function drawStateCanvas(s) {
  const canvas = el('state-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  if (!tm) return;

  const states = tm.states;
  const n      = states.length;

  // Layout states in a row or ellipse
  const positions = {};
  const cx = W / 2, cy = H / 2;
  const rx = Math.min(W * 0.42, 320);
  const ry = Math.min(H * 0.38, 110);

  states.forEach((state, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    positions[state] = {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle)
    };
  });

  // Draw transitions (arrows)
  ctx.strokeStyle = 'rgba(100,116,139,0.35)';
  ctx.lineWidth   = 1.2;
  tm.transitions.forEach(tr => {
    const from = positions[tr.from];
    const to   = positions[tr.to];
    if (!from || !to || tr.from === tr.to) return;
    drawArrow(ctx, from.x, from.y, to.x, to.y, 20);
  });

  // Draw states
  states.forEach(state => {
    const pos = positions[state];
    if (!pos) return;
    // NFA: a state is "active" if it's in the current states Set
    const isActive  = s && (
      s.mode === 'nfa' && s.currentStates
        ? s.currentStates.has(state)
        : s.state === state
    );
    const isAccept  = state === tm.acceptState;
    const isReject  = state === tm.rejectState;
    const isStart   = state === tm.start;
    const r = 26;

    // Glow for active
    if (isActive) {
      ctx.shadowBlur  = 18;
      ctx.shadowColor = '#8b5cf6';
    } else {
      ctx.shadowBlur = 0;
    }

    // Outer circle fill
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);

    if (isActive)  { ctx.fillStyle = 'rgba(124,58,237,0.55)'; }
    else if (isAccept) { ctx.fillStyle = 'rgba(16,185,129,0.2)'; }
    else if (isReject) { ctx.fillStyle = 'rgba(239,68,68,0.15)'; }
    else           { ctx.fillStyle = 'rgba(20,27,53,0.9)'; }
    ctx.fill();

    // Border
    ctx.strokeStyle = isActive  ? '#8b5cf6'
                    : isAccept  ? '#10b981'
                    : isReject  ? '#ef4444'
                    : 'rgba(148,163,184,0.25)';
    ctx.lineWidth   = isActive  ? 2.5 : 1.5;
    ctx.stroke();

    // Double circle for accept
    if (isAccept) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r - 5, 0, 2 * Math.PI);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    ctx.shadowBlur = 0;

    // Label
    ctx.fillStyle = isActive  ? '#e9d5ff'
                  : isAccept  ? '#34d399'
                  : isReject  ? '#f87171'
                  : '#94a3b8';
    ctx.font       = `600 11px 'Inter', sans-serif`;
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state, pos.x, pos.y);

    // Start arrow
    if (isStart) {
      ctx.strokeStyle = 'rgba(167,139,250,0.6)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(pos.x - r - 24, pos.y);
      ctx.lineTo(pos.x - r - 3, pos.y);
      ctx.stroke();
      drawArrowHead(ctx, pos.x - r - 3, pos.y, 0, 6);
    }
  });
}

function drawArrow(ctx, x1, y1, x2, y2, nodeR) {
  const dx = x2 - x1, dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;

  const ux = dx / dist, uy = dy / dist;
  const sx = x1 + ux * nodeR;
  const sy = y1 + uy * nodeR;
  const ex = x2 - ux * nodeR;
  const ey = y2 - uy * nodeR;

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  drawArrowHead(ctx, ex, ey, Math.atan2(dy, dx), 7);
}

function drawArrowHead(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(100,116,139,0.5)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size / 2);
  ctx.lineTo(-size, -size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────
//  RESULT DISPLAY
// ──────────────────────────────────────────────────────────────

/**
 * showSolution — core output per problem spec
 * | accept | Exact answer + reasoning          |
 * | reject | Exact answer + rejection analysis |
 * | loop   | Step-limited approximation        |
 */
function showSolution(type, rejectReason) {
  let msg = "=== Execution Result ===\n\n";

  if (type === "accept") {
    msg += "✔ Machine halted successfully.\n";
    msg += "Exact solution obtained.\n";
    msg += "The input string is ACCEPTED.\n\n";
    msg += "Reasoning:\n";
    msg += "- The TM reached the designated accept state (q_accept).\n";
    msg += "- Computation terminated in a finite number of steps.\n";
    msg += "- This is an EXACT result — no approximation required.\n\n";
  }

  if (type === "reject") {
    msg += "✔ Machine halted.\n";
    msg += "Exact solution obtained.\n";
    msg += "The input string is REJECTED.\n\n";

    msg += "=== Rejection Analysis ===\n\n";

    if (rejectReason && rejectReason.type === 'missing_transition') {
      // ── Sub-Case A: incomplete DFA ──────────────────────────────────────
      msg += "📌 Sub-Case A: REJECT via Missing Transition\n";
      msg += "────────────────────────────────────────────\n";
      msg += `Root Cause : No δ(${rejectReason.state}, ${
        rejectReason.symbol === '_' ? '␣ blank' : rejectReason.symbol
      }) exists in the TM.\n`;
      msg += "Explanation: The TM had no defined move for this (state, symbol)\n";
      msg += "             pair, so it halted immediately in q_reject.\n\n";
      msg += "Possible Reasons:\n";
      msg += "  1. Input path not covered by the automaton\n";
      msg += "  2. DFA/NFA definition is incomplete (missing transitions)\n";
      msg += "  3. String does not belong to the language\n\n";
      msg += "Optimal Solutions:\n";
      msg += `  ✔ Add: δ(${
        rejectReason.state}, ${
        rejectReason.symbol === '_' ? '␣' : rejectReason.symbol
      }) → <target_state>\n`;
      msg += "  ✔ Or add a dead/trap state to absorb all missing paths\n";
      msg += "  ✔ If intentional → string is correctly rejected\n\n";

    } else if (rejectReason && rejectReason.type === 'explicit_reject') {
      // ── Sub-Case B: deliberate rejection via defined transition ─────────
      msg += "📌 Sub-Case B: REJECT via Explicit Transition to q_reject\n";
      msg += "──────────────────────────────────────────────────────────\n";
      msg += `Root Cause : The path through state '${rejectReason.via}' has a\n`;
      msg += "             defined transition that leads to q_reject.\n";
      msg += "             This is NOT a missing transition.\n\n";
      msg += "Key Insight — Why this is NOT an infinite loop:\n";
      msg += "  → The machine HALTED cleanly in q_reject.\n";
      msg += "  → An infinite loop only occurs when the TM NEVER halts\n";
      msg += "    (no q_accept / q_reject reached within step limit).\n";
      msg += "  → A REJECT is an explicit halt → Exact Result is correct.\n\n";
      msg += "Possible Reasons:\n";
      msg += "  1. Input string does not satisfy the language\n";
      msg += "  2. Automaton correctly identifies this as a non-member\n\n";
      msg += "Optimal Solutions:\n";
      msg += "  ✔ Verify automaton design matches the intended language\n";
      msg += "  ✔ Check if accept states include all required states\n";
      msg += "  ✔ Confirm the string should/should not be in the language\n\n";
      msg += "💡 Want infinite loop? Click 'Load Loop Example' to see\n";
      msg += "   a TM that cycles q0 ↔ q1 forever and hits the step limit.\n\n";

    } else {
      // ── Sub-Case C: fallback ─────────────────────────────────────────────
      msg += "📌 Sub-Case C: REJECT (general)\n";
      msg += "────────────────────────────────\n";
      msg += "Possible Reasons:\n";
      msg += "  1. Input string does not satisfy the language\n";
      msg += "  2. Transition led to reject state\n";
      msg += "  3. Missing transition in automaton (incomplete DFA)\n\n";
      msg += "Optimal Solutions:\n";
      msg += "  ✔ Ensure transition function is complete (for DFA)\n";
      msg += "  ✔ Verify correctness of automaton design\n";
      msg += "  ✔ Check if input string belongs to the language\n\n";
    }

    msg += "Conclusion: EXACT result — machine halted in finite steps.\n\n";
  }

  if (type === "loop") {
    msg += "⚠ Machine did NOT halt within the step limit.\n";
    msg += "Execution stopped after the configured maximum steps.\n\n";
    msg += "Approximate Solution (Step-Limited Execution):\n";
    msg += "  • The machine appears to be in an infinite loop.\n";
    msg += "  • Exact result CANNOT be determined.\n";
    msg += "  • Step-limited execution is used as a practical solution.\n\n";
  }

  msg += "─────────────────────────────────────────\n";
  msg += "Concept Insight — The Halting Problem:\n";
  msg += "The Halting Problem (Turing, 1936) proves that no\n";
  msg += "algorithm can determine whether a TM halts for ALL\n";
  msg += "inputs. Exact solutions exist when machines halt;\n";
  msg += "only bounded approximations are possible otherwise.\n";

  el("solutionBox").textContent = msg;
}

function acceptCase(steps) {
  el("stateInfo").textContent = "✅ ACCEPTED — Machine halted in " + steps + " step(s)";
  el("result-icon").textContent = "✅";
  showSolution("accept", null);
}

function rejectCase(steps, rejectReason) {
  let reasonLabel = '';
  if (rejectReason) {
    if (rejectReason.type === 'missing_transition') {
      reasonLabel = ` — No δ(${rejectReason.state}, ${
        rejectReason.symbol === '_' ? '␣' : rejectReason.symbol
      }) [Sub-Case A]`;
    } else if (rejectReason.type === 'explicit_reject') {
      reasonLabel = ` — Explicit path → q_reject via '${rejectReason.via}' [Sub-Case B]`;
    }
  }
  el("stateInfo").textContent = `❌ REJECTED — Machine halted in ${steps} step(s)${reasonLabel}`;
  el("result-icon").textContent = "❌";
  showSolution("reject", rejectReason);
}

function loopCase(maxSteps) {
  el("stateInfo").textContent = "⚠ STOPPED — Step limit reached (" + maxSteps + " steps). Possible Infinite Loop.";
  el("result-icon").textContent = "⚠";
  showSolution("loop");
}

function finalizeResult(result, maxSteps) {
  const card = el('result-card');
  show('result-card');
  card.className = 'result-card';

  if (result === 'accept') {
    card.classList.add('accept-glow');
    acceptCase(simState ? simState.step : 0);
  } else if (result === 'reject') {
    card.classList.add('reject-glow');
    // ★ Pass the rejectReason (state/symbol + type) captured during simulation
    rejectCase(simState ? simState.step : 0, simState ? simState.rejectReason : null);
  } else {
    card.classList.add('loop-glow');
    loopCase(maxSteps);
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ──────────────────────────────────────────────────────────────
//  TOAST NOTIFICATION
// ──────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;

  const colors = { info: '#8b5cf6', warn: '#f59e0b', error: '#ef4444' };
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '28px',
    right: '28px',
    background: '#0f1428',
    border: `1px solid ${colors[type] || colors.info}`,
    borderRadius: '10px',
    padding: '12px 20px',
    fontSize: '0.87rem',
    color: '#f1f5f9',
    zIndex: '9999',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    animation: 'fadeInUp 0.3s ease both',
    fontFamily: "'Inter', sans-serif",
    maxWidth: '340px'
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ──────────────────────────────────────────────────────────────
//  NAV SCROLL HIGHLIGHT
// ──────────────────────────────────────────────────────────────
const sections = ['converter', 'simulator', 'theory'];
window.addEventListener('scroll', () => {
  let current = 'converter';
  for (const id of sections) {
    const sec = document.getElementById(id);
    if (sec && window.scrollY + 140 >= sec.offsetTop) current = id;
  }
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.id === `nav-${current}`);
  });
});

// ──────────────────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Parse the default example on load
  parseAutomaton();
  // Draw empty canvas
  drawStateCanvas(null);
});
