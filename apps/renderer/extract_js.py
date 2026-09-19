"""Browser-side helpers for POST /extract (SPEC §6.5, the 平台元件庫).

Two scripts, run through CDP (`page.evaluate` works even though page scripts
are disabled):

* `CHOOSE_JS` picks the element the reviewer drew a rectangle around: the
  smallest ancestor of the rectangle's centre whose border box covers at least
  90% of the rectangle. It marks it with a temporary attribute and reports its
  box, so the caller can clip a thumbnail before anything is modified.
* `SERIALIZE_JS` then makes that subtree self-contained: every computed
  property that differs from a bare element of the same tag (or, for inherited
  properties, from the element's own parent) is written into a `style`
  attribute, so the snippet renders identically when Agent B pastes it into
  another document that has none of the original page's CSS.

Nothing here loads a resource: properties whose value contains `url(` are
dropped, which also keeps the snippet inside the replica safety rules.
"""

# Properties worth pinning. Anything not listed is left to the host document.
_PROPS = """
display position top right bottom left float clear z-index overflow-x overflow-y visibility opacity
box-sizing width height min-width min-height max-width max-height
margin-top margin-right margin-bottom margin-left
padding-top padding-right padding-bottom padding-left
border-top-width border-right-width border-bottom-width border-left-width
border-top-style border-right-style border-bottom-style border-left-style
border-top-color border-right-color border-bottom-color border-left-color
border-top-left-radius border-top-right-radius border-bottom-right-radius border-bottom-left-radius
background-color background-image background-size background-position background-repeat background-clip box-shadow
flex-direction flex-wrap justify-content align-items align-self align-content gap flex-grow flex-shrink flex-basis order
grid-template-columns grid-template-rows
color font-family font-size font-weight font-style line-height letter-spacing word-spacing
text-align text-decoration-line text-decoration-color text-transform text-overflow white-space vertical-align
list-style-type transform transform-origin
fill stroke stroke-width stroke-linecap stroke-linejoin
"""

# Properties a child inherits from its parent: skipped on descendants whose
# parent already carries the same value (the parent is inside the snippet).
_INHERITED = """
color font-family font-size font-weight font-style line-height letter-spacing word-spacing
text-align text-transform white-space list-style-type visibility fill stroke stroke-width
stroke-linecap stroke-linejoin
"""

MARKER = "data-extract-target"

CHOOSE_JS = """
(box) => {
  const { rx, ry, rw, rh } = box;
  const area = rw * rh;
  const coverage = (el) => {
    const b = el.getBoundingClientRect();
    const ix = Math.max(0, Math.min(b.right, rx + rw) - Math.max(b.left, rx));
    const iy = Math.max(0, Math.min(b.bottom, ry + rh) - Math.max(b.top, ry));
    return area > 0 ? (ix * iy) / area : 0;
  };
  let el = document.elementFromPoint(rx + rw / 2, ry + rh / 2);
  let chosen = null;
  while (el && el !== document.documentElement && el !== document.body) {
    if (coverage(el) >= 0.9) { chosen = el; break; }
    el = el.parentElement;
  }
  if (!chosen) chosen = document.body;
  chosen.setAttribute('%MARKER%', '1');
  const b = chosen.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height, tag: chosen.tagName.toLowerCase() };
}
""".replace("%MARKER%", MARKER)

SERIALIZE_JS = """
(input) => {
  const PROPS = %PROPS%;
  const INHERITED = new Set(%INHERITED%);
  const root = document.querySelector('[%MARKER%]');
  if (!root) return null;

  const host = document.createElement('div');
  host.setAttribute('style', 'all:initial;position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden');
  document.body.appendChild(host);
  const defaults = new Map();
  const defaultsFor = (el) => {
    const key = el.namespaceURI + '|' + el.tagName;
    if (defaults.has(key)) return defaults.get(key);
    let probe;
    try { probe = document.createElementNS(el.namespaceURI, el.tagName); } catch (e) { probe = document.createElement('div'); }
    host.appendChild(probe);
    const cs = getComputedStyle(probe);
    const d = {};
    for (const p of PROPS) d[p] = cs.getPropertyValue(p);
    host.removeChild(probe);
    defaults.set(key, d);
    return d;
  };

  const elements = [root, ...root.querySelectorAll('*')];
  const styles = elements.map((el) => {
    const cs = getComputedStyle(el);
    const base = defaultsFor(el);
    const parentCs = el === root ? null : (el.parentElement ? getComputedStyle(el.parentElement) : null);
    const inline = cs.getPropertyValue('display') === 'inline';
    const transformed = cs.getPropertyValue('transform') !== 'none';
    const out = [];
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v || v.indexOf('url(') !== -1) continue;
      if ((p === 'width' || p === 'height') && inline) continue;
      if (p === 'transform-origin' && !transformed) continue;
      if (p.startsWith('border-') && p.endsWith('-color')
          && cs.getPropertyValue(p.replace('-color', '-style')) === 'none') continue;
      // an inherited property is compared with the parent inside the snippet;
      // the root has no such parent, so it falls back to the bare-element default
      const inherited = INHERITED.has(p);
      const same = inherited && parentCs ? parentCs.getPropertyValue(p) === v : base[p] === v;
      // box-sizing is always written: the host page may set it globally, and
      // the pinned width/height are resolved against whichever box it names
      if (same && p !== 'box-sizing') continue;
      out.push(p + ':' + v);
    }
    return out;
  });
  host.remove();

  elements.forEach((el, i) => {
    const own = el.getAttribute('style');
    const merged = styles[i].join(';') + (own ? ';' + own : '');
    if (merged) el.setAttribute('style', merged);
  });
  root.removeAttribute('%MARKER%');
  for (const [k, v] of Object.entries(input.attrs || {})) root.setAttribute(k, v);
  return root.outerHTML;
}
""".replace("%MARKER%", MARKER) \
   .replace("%PROPS%", repr(_PROPS.split()).replace("'", '"')) \
   .replace("%INHERITED%", repr(_INHERITED.split()).replace("'", '"'))
