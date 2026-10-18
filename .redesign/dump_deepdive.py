import json, sys
J='/root/.claude/projects/-home-user-popping/e916a025-a6d4-5a44-8e35-65aa013571f3/subagents/workflows/wf_14a9af43-da9/journal.jsonl'
OUT='/home/user/popping/REDESIGN_DEEP_DIVE.md'
readers, designs, judges, synth, verifs, critic = {}, [], [], None, [], None
for line in open(J):
    try: j=json.loads(line)
    except: continue
    if j.get('type')!='result': continue
    r=j.get('result') or j.get('value')
    if isinstance(r,str):
        try: r=json.loads(r)
        except: continue
    if not isinstance(r,dict): continue
    if 'area' in r and 'report' in r: readers[r['area']]=r
    elif 'design' in r and 'key_decisions' in r: designs.append(r)
    elif 'scores' in r and 'winner' in r: judges.append(r)
    elif 'plan' in r and 'steps' in r: synth=r
    elif 'lens' in r and 'verdicts' in r: verifs.append(r)
    elif 'complaint_coverage' in r: critic=r
o=[]
o.append('# Redesign deep dive: raw results\n')
o.append('Generated from the deep-dive workflow journal. Raw agent output, not edited. REDESIGN_PLAN.md is the curated plan; this file is the evidence behind it and survives if the session ends.\n')
o.append(f'Progress: {len(readers)} code readers, {len(designs)} designs, {len(judges)} judges, synthesis {"done" if synth else "not yet"}, {len(verifs)} verifiers, critic {"done" if critic else "not yet"}.\n')
if critic:
    o.append('## Completeness critic\n')
    for c in critic['complaint_coverage']: o.append(f"- Requirement {c['complaint']}: covered by {c['covered_by']}. Gap: {c['gap']}")
    o.append('\nMissing:'); o+= ['- '+m for m in critic['missing']]
    o.append('\nOver-scoped:'); o+= ['- '+m for m in critic['over_scoped']]
    o.append('')
if verifs:
    o.append('## Verifier findings\n')
    for v in verifs:
        o.append(f"### {v['lens']}\n")
        for x in v['verdicts']:
            o.append(f"- [{x['status']}] {x['claim']}\n  - Evidence: {x['evidence']}" + (f"\n  - Correction: {x['correction']}" if x.get('correction') else ''))
        if v['additions']:
            o.append('\nAdditions:'); o+=['- '+a for a in v['additions']]
        o.append('')
if synth:
    o.append('## Synthesized plan\n')
    o.append(synth['plan'])
    o.append('\n### Steps\n')
    for st in synth['steps']:
        o.append(f"- **{st['id']} {st['title']}** (depends on: {', '.join(st['depends_on']) or 'none'})\n  - Files: {', '.join(st['files'])}\n  - Change: {st['change']}\n  - Acceptance: {st['acceptance']}\n  - Verification: {st['verification']}")
    o.append('\n### Audit checklist\n')
    for a in synth['audit_checklist']: o.append(f"- [{a['area']}][{a['confidence']}] {a['file']}:{a['line']}: {a['issue']} Fix: {a['fix']}")
    o.append('\n### Open decisions\n'); o+=['- '+x for x in synth['open_decisions']]
    o.append('\n### Risks\n'); o+=['- '+x for x in synth['risks']]
    o.append('')
if judges:
    o.append('## Judges\n')
    for i,jd in enumerate(judges):
        o.append(f"### Judge {i+1}: winner {jd['winner']}\n")
        for sc in jd['scores']: o.append(f"- {sc['design']}: total {sc['total']} (coverage {sc['complaints_coverage']}, fit {sc['codebase_fit']}, low risk {sc['regression_risk_inverse']}, effort {sc['effort_proportionality']}, iOS feel {sc['ios_feel']}). {sc['notes']}")
        o.append('\nGraft:'); o+=['- '+g for g in jd['graft_from_others']]
        o.append('\nShared blind spots:'); o+=['- '+b for b in jd['shared_blind_spots']]
        o.append('')
if designs:
    o.append('## Designs\n')
    for d in designs:
        o.append(f"### {d['name']}\n\nKey decisions:\n" + '\n'.join('- '+k for k in d['key_decisions']) + '\n\n' + d['design'] + '\n')
o.append('## Code reader reports\n')
for a,r in readers.items():
    o.append(f"### {a}\n\n{r['report']}\n\n#### Constraints\n" + '\n'.join('- '+c for c in r['constraints']) + '\n\n#### Findings\n' + '\n'.join(f"- [{f['confidence']}] {f['file']}:{f['line']}: {f['issue']} Fix: {f['suggested_fix']}" for f in r['findings']) + '\n')
open(OUT,'w').write('\n'.join(o))
print(f"readers={len(readers)} designs={len(designs)} judges={len(judges)} synth={bool(synth)} verifs={len(verifs)} critic={bool(critic)} bytes={sum(len(x) for x in o)}")
