/* AMA — Content script
 * Builds ARIA tree from DOM, extracts page data.
 * No UI — side panel handles all display.
 * Responds to messages requesting page data.
 */

(function () {
  'use strict';

  const api = typeof browser !== 'undefined' ? browser : chrome;

  /* ══════════════════════════════════════════════════════════════
     ARIA TREE — Role taxonomy + pruning + formatting
     Embedded from barebrowse/src/prune.js and barebrowse/src/aria.js
     ══════════════════════════════════════════════════════════════ */

  // --- Role taxonomy ---

  const LANDMARKS = new Set([
    'banner', 'main', 'contentinfo', 'navigation', 'complementary',
    'search', 'form', 'region',
  ]);

  const INTERACTIVE = new Set([
    'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
    'combobox', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
  ]);

  const GROUPS = new Set([
    'radiogroup', 'tablist', 'menu', 'menubar', 'toolbar',
    'listbox', 'tree', 'treegrid', 'grid',
  ]);

  const STRUCTURAL = new Set([
    'generic', 'group', 'list', 'table', 'row', 'rowgroup', 'cell',
    'directory', 'document', 'application', 'presentation', 'none', 'separator',
    'LayoutTable', 'LayoutTableRow', 'LayoutTableCell',
  ]);

  const MODE_REGIONS = {
    act: new Set(['main']),
    browse: new Set(['main']),
    navigate: new Set(['main', 'banner', 'navigation', 'search']),
    full: new Set(['main', 'banner', 'navigation', 'contentinfo', 'complementary', 'search']),
  };

  const SKIP_ROLES = new Set([
    'InlineTextBox', 'LineBreak', 'superscript',
  ]);

  // --- Implicit ARIA roles for HTML elements ---

  const IMPLICIT_ROLES = {
    A: 'link',
    ARTICLE: 'article',
    ASIDE: 'complementary',
    BUTTON: 'button',
    DATALIST: 'listbox',
    DETAILS: 'group',
    DIALOG: 'dialog',
    DL: 'list',
    DT: 'term',
    DD: 'definition',
    FIELDSET: 'group',
    FIGURE: 'figure',
    FOOTER: 'contentinfo',
    FORM: 'form',
    H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
    HEADER: 'banner',
    HR: 'separator',
    IMG: 'img',
    INPUT: 'textbox',  // refined below based on type
    LI: 'listitem',
    MAIN: 'main',
    MENU: 'menu',
    NAV: 'navigation',
    OL: 'list',
    OPTION: 'option',
    OUTPUT: 'status',
    P: 'paragraph',
    PRE: 'group',
    PROGRESS: 'progressbar',
    SECTION: 'region',
    SELECT: 'combobox',
    SUMMARY: 'button',
    TABLE: 'table',
    TBODY: 'rowgroup',
    TD: 'cell',
    TEXTAREA: 'textbox',
    TFOOT: 'rowgroup',
    TH: 'cell',
    THEAD: 'rowgroup',
    TR: 'row',
    UL: 'list',
  };

  const INPUT_TYPE_ROLES = {
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    search: 'searchbox',
    spinbutton: 'spinbutton',
    submit: 'button',
    reset: 'button',
    button: 'button',
  };

  const NOISE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE', 'IFRAME', 'NOSCRIPT',
    'LINK', 'META', 'BASE',
  ]);

  // --- DOM → ARIA tree walker ---

  let _nodeIdCounter = 0;

  function buildAriaTree(root) {
    _nodeIdCounter = 0;
    const children = [];
    for (const child of root.childNodes) {
      const node = walkDOM(child);
      if (node) children.push(node);
    }
    return {
      nodeId: String(++_nodeIdCounter),
      role: 'RootWebArea',
      name: document.title || '',
      properties: {},
      ignored: false,
      children,
    };
  }

  function walkDOM(el) {
    if (el.nodeType === Node.TEXT_NODE) {
      const text = el.textContent.trim();
      if (!text) return null;
      return {
        nodeId: String(++_nodeIdCounter),
        role: 'StaticText',
        name: text,
        properties: {},
        ignored: false,
        children: [],
      };
    }

    if (el.nodeType !== Node.ELEMENT_NODE) return null;
    if (NOISE_TAGS.has(el.tagName)) return null;

    // Skip hidden elements
    if (el.getAttribute('aria-hidden') === 'true') return null;
    if (el.hidden) return null;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
    } catch { /* skip check */ }

    // Determine role
    let role = el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || 'generic';

    // Refine input roles
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden') return null;
      role = el.getAttribute('role') || INPUT_TYPE_ROLES[type] || 'textbox';
    }

    // A tags without href are generic
    if (el.tagName === 'A' && !el.hasAttribute('href')) role = 'generic';

    // Footer/header inside main/article/section are generic, not landmark
    if ((el.tagName === 'FOOTER' || el.tagName === 'HEADER') && el.closest('main, article, section')) {
      role = 'generic';
    }

    // Compute accessible name
    const name = computeAccessibleName(el, role);

    // Extract properties
    const properties = {};
    if (role === 'heading') {
      const tag = el.tagName;
      if (/^H[1-6]$/.test(tag)) properties.level = parseInt(tag[1], 10);
    }
    if (el.getAttribute('aria-expanded') !== null) {
      properties.expanded = el.getAttribute('aria-expanded') === 'true';
    }
    if (el.getAttribute('aria-checked') !== null) {
      properties.checked = el.getAttribute('aria-checked') === 'true';
    }
    if (el.checked !== undefined && (role === 'checkbox' || role === 'radio')) {
      properties.checked = el.checked;
    }
    if (el.getAttribute('aria-selected') !== null) {
      properties.selected = el.getAttribute('aria-selected') === 'true';
    }
    if (el.disabled) properties.disabled = true;
    if (el.required) properties.required = true;
    if (el.getAttribute('aria-level')) {
      properties.level = parseInt(el.getAttribute('aria-level'), 10);
    }
    // Capture href on links — critical for LLM to use real URLs
    if (role === 'link' && el.tagName === 'A' && el.href) {
      try {
        const linkUrl = new URL(el.href, location.href);
        if (linkUrl.origin === location.origin) {
          properties.url = linkUrl.pathname + linkUrl.search;
        } else {
          properties.url = el.href;
        }
      } catch { /* skip bad urls */ }
    }

    // Recurse children
    const children = [];
    for (const child of el.childNodes) {
      const node = walkDOM(child);
      if (node) children.push(node);
    }

    // Skip generic nodes with no name and no children
    if (role === 'generic' && !name && children.length === 0) return null;

    return {
      nodeId: String(++_nodeIdCounter),
      role,
      name: name || '',
      properties,
      ignored: false,
      children,
    };
  }

  function computeAccessibleName(el, role) {
    // aria-label takes priority
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    // Images: alt text
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();

    // Inputs: associated label
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return label.textContent.trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel) {
        // Get label text excluding the input itself
        let text = '';
        for (const child of parentLabel.childNodes) {
          if (child === el) continue;
          if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
          else if (child.nodeType === Node.ELEMENT_NODE && child !== el) text += child.textContent;
        }
        text = text.trim();
        if (text) return text;
      }
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return placeholder.trim();
      return '';
    }

    // Buttons: textContent
    if (role === 'button' || el.tagName === 'BUTTON') {
      return (el.textContent || '').trim().slice(0, 100);
    }

    // Links: textContent
    if (role === 'link') {
      const text = (el.textContent || '').trim();
      if (text) return text.slice(0, 200);
      // Fallback to nested img alt
      const img = el.querySelector('img[alt]');
      if (img) return img.alt.trim();
      return '';
    }

    // Headings: textContent
    if (role === 'heading') {
      return (el.textContent || '').trim().slice(0, 200);
    }

    // Landmark regions: aria-label already handled above, try heading
    if (LANDMARKS.has(role)) {
      const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading) return heading.textContent.trim().slice(0, 100);
      return '';
    }

    return '';
  }

  // --- Pruning pipeline (from barebrowse/src/prune.js) ---

  function prune(tree, options = {}) {
    const { mode = 'full', context = '' } = options;
    const allowedRegions = MODE_REGIONS[mode] || MODE_REGIONS.full;
    const isBrowse = mode === 'browse';
    const keywords = context
      ? context.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
      : [];

    let nodes = tree ? [tree] : [];

    // Step 1: Extract landmark regions
    nodes = extractRegions(nodes, allowedRegions);

    // Step 2: Prune nodes
    const ctx = { mode, parentRole: null, keywords };
    nodes = nodes.map((n) => pruneNode(n, ctx)).filter(Boolean);

    // Step 3: Collapse structural wrappers
    nodes = nodes.map((n) => collapseNode(n)).filter(Boolean);

    // Step 4: Post-clean
    nodes = nodes.map((n) => postClean(n, isBrowse)).filter(Boolean);

    // Steps 5-8: E-commerce noise removal (skip in browse mode)
    if (!isBrowse) {
      nodes = dedupLinks(nodes);
      nodes = nodes.map((n) => dropNoiseButtons(n)).filter(Boolean);
      nodes = truncateAfterFooter(nodes);
      nodes = nodes.map((n) => dropFilterGroups(n)).filter(Boolean);
    }

    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0];
    return { nodeId: '', role: 'root', name: '', properties: {}, ignored: false, children: nodes };
  }

  function extractRegions(nodes, allowedRegions) {
    if (nodes.length === 1 && (nodes[0].role === 'RootWebArea' || nodes[0].role === 'WebArea')) {
      nodes = nodes[0].children;
    }
    const hasLandmarks = nodes.some((n) => LANDMARKS.has(n.role));
    const mainNode = nodes.find((n) => n.role === 'main');
    const hasMain = mainNode ? (hasInteractive(mainNode) || hasHeading(mainNode)) : false;

    const results = [];
    for (const node of nodes) {
      if (LANDMARKS.has(node.role)) {
        if (isRegionAllowed(node, allowedRegions)) results.push(node);
      } else if (hasLandmarks && hasMain) {
        if (allowedRegions.has('navigation')) results.push(node);
      } else if (hasLandmarks && !hasMain) {
        if (hasInteractive(node) || hasHeading(node)) results.push(node);
      } else {
        results.push(node);
      }
    }
    return results;
  }

  function isRegionAllowed(node, allowedRegions) {
    if (allowedRegions.has(node.role)) return true;
    if (node.role === 'region' && allowedRegions.has('main')) {
      const auxPatterns = /image|review|recommend|related|similar|also viewed|cookie/i;
      if (node.name && auxPatterns.test(node.name)) return false;
      return true;
    }
    return false;
  }

  function pruneNode(node, ctx) {
    if (!node) return null;
    if (SKIP_ROLES.has(node.role)) return null;

    const isBrowse = ctx.mode === 'browse';
    const level = node.properties?.level;

    if (ctx.mode === 'act' && node.role === 'link' && ctx.parentRole === 'paragraph') return null;

    if (node.role === 'paragraph') {
      if (ctx.mode === 'act') return null;
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    if (isBrowse && node.role === 'navigation') return null;
    if (node.role === 'code') return node;

    if (node.role === 'term' || node.role === 'definition') {
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    if (isBrowse && (node.role === 'strong' || node.role === 'emphasis' || node.role === 'blockquote')) {
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    if (isBrowse && node.role === 'figure') {
      if (node.name) return { ...node, role: 'StaticText', name: `[Figure: ${node.name}]`, children: [] };
      return null;
    }

    if (INTERACTIVE.has(node.role)) {
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    if (!isBrowse && ctx.keywords.length > 0 && node.role === 'listitem' && hasInteractive(node)) {
      const text = extractTextFromNode(node).toLowerCase();
      if (!ctx.keywords.some((kw) => text.includes(kw))) return condenseCard(node);
    }

    if (GROUPS.has(node.role) && node.name) {
      return { ...node, children: pruneChildren(node.children, ctx) };
    }
    if (node.role === 'group' && node.name) {
      if (!isBrowse && /kleuren|colors?|couleurs?|farben/i.test(node.name)) return collapseColors(node);
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    if (node.role === 'heading') {
      if (!isBrowse && level !== '1' && level !== 1) {
        if (node.name && /about this|description|detail|feature|specification|overview/i.test(node.name)) return null;
      }
      return { ...node, children: [] };
    }

    if (node.role === 'StaticText') return keepText(node, ctx.mode) ? node : null;

    if (node.role === 'img' || node.role === 'image') {
      if (isBrowse && node.name) return { ...node, children: [] };
      return null;
    }

    if (node.role === 'separator') return null;

    if (node.role === 'complementary') {
      if (isBrowse) return { ...node, children: pruneChildren(node.children, ctx) };
      return null;
    }

    if (node.role === 'region' && !isBrowse) {
      if (node.name && /image|review|recommend|related|similar|also viewed/i.test(node.name)) return null;
    }

    if (isBrowse && (node.role === 'note' || node.role === 'status')) {
      return { ...node, children: pruneChildren(node.children, ctx) };
    }

    const childCtx = { ...ctx, parentRole: node.role };
    const keptChildren = pruneChildren(node.children, childCtx);

    if (!isBrowse) {
      if (node.role === 'list' && keptChildren.every((c) => !hasInteractive(c))) return null;
      if (node.role === 'listitem' && !hasInteractive(node)) return null;
    }

    if (keptChildren.length > 0) return { ...node, children: keptChildren };
    return null;
  }

  function pruneChildren(children, ctx) {
    if (!children) return [];
    return children.map((c) => pruneNode(c, ctx)).filter(Boolean);
  }

  function keepText(node, mode) {
    const t = node.name || '';
    if (!t) return false;
    if (mode === 'browse') {
      if (t.length <= 2 && /^[|»·•→←>\-]$/.test(t.trim())) return false;
      return true;
    }
    if (/\$[\d,]+\.?\d*|€[\d,]+/.test(t)) return true;
    if (/in stock|out of stock|unavailable|available/i.test(t)) return true;
    if (/delivery|shipping|free/i.test(t)) return true;
    if (t.length < 40 && t.endsWith(':')) return true;
    if (t.length < 30) return true;
    return false;
  }

  function collapseNode(node) {
    if (!node) return null;
    node = { ...node, children: (node.children || []).map((c) => collapseNode(c)).filter(Boolean) };
    const isTableLayout = /^LayoutTable/.test(node.role) ||
      node.role === 'row' || node.role === 'cell' || node.role === 'rowgroup';
    if ((STRUCTURAL.has(node.role) && !node.name) || isTableLayout) {
      if (node.children.length === 1) return node.children[0];
      if (node.children.length > 0) return { ...node, role: '_promote', children: node.children };
      return null;
    }
    return node;
  }

  function postClean(node, isBrowse) {
    if (!node) return null;
    if (node.role === 'combobox' || node.role === 'listbox') {
      const selected = (node.children || []).find((c) => c.properties?.selected);
      return { ...node, name: selected?.name || node.name, children: [] };
    }
    node = { ...node, children: (node.children || []).map((c) => postClean(c, isBrowse)).filter(Boolean) };
    if (!isBrowse && node.children) {
      node = { ...node, children: dropOrphanedHeadings(node.children) };
    }
    return node;
  }

  function dropOrphanedHeadings(children) {
    const result = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const level = child.properties?.level;
      if (child.role === 'heading' && level !== '1' && level !== 1) {
        let found = false;
        for (let j = i + 1; j < children.length; j++) {
          if (children[j].role === 'heading') break;
          if (hasInteractive(children[j])) { found = true; break; }
        }
        if (!found) continue;
      }
      result.push(child);
    }
    return result;
  }

  function dedupLinks(nodes) {
    const seen = new Map();
    return nodes.map((n) => dedupLinksIn(n, seen)).filter(Boolean);
  }

  function dedupLinksIn(node, seen) {
    if (!node) return null;
    if (node.role === 'link' && node.name) {
      if (seen.has(node.name)) return null;
      seen.set(node.name, true);
    }
    if (node.role === 'listitem') {
      const local = new Map();
      node = { ...node, children: (node.children || []).map((c) => dedupLinksIn(c, local)).filter(Boolean) };
      return node.children.length > 0 ? node : null;
    }
    node = { ...node, children: (node.children || []).map((c) => dedupLinksIn(c, seen)).filter(Boolean) };
    return node;
  }

  const NOISE_BUTTONS = /energieklasse|energy\s*class|productinformatieblad|product\s*information\s*sheet|gesponsorde|sponsored|ad\s*feedback|sterren.*details.*beoordeling|stars.*rating\s*detail/i;
  const NOISE_LINKS = /^opties bekijken$|^view options$|^see options$|^voir les options$/i;
  const FOOTER_LINKS = /gebruiks.*voorwaarden|conditions.*use|privacy|cookie|contactgegevens|contact\s*info|advertenties|interest.*ads|lees\s*meer\s*over\s*deze\s*resultaten/i;

  function dropNoiseButtons(node) {
    if (!node) return null;
    if (node.role === 'button' && node.name && NOISE_BUTTONS.test(node.name)) return null;
    if (node.role === 'link' && node.name && (NOISE_LINKS.test(node.name) || FOOTER_LINKS.test(node.name))) return null;
    node = { ...node, children: (node.children || []).map((c) => dropNoiseButtons(c)).filter(Boolean) };
    return node;
  }

  function truncateAfterFooter(nodes) {
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (isFooterMarker(node)) break;
      if (isSkippable(node)) continue;
      if (node.children?.length > 0) {
        const trimmed = { ...node, children: truncateAfterFooter(node.children) };
        if (trimmed.children.length === 0 && STRUCTURAL.has(trimmed.role)) continue;
        result.push(trimmed);
      } else {
        result.push(node);
      }
    }
    return result;
  }

  function isFooterMarker(node) {
    if (node.role === 'button' && node.name && /terug naar boven|back to top/i.test(node.name)) return true;
    const level = node.properties?.level;
    if (node.role === 'heading' && (level === '6' || level === 6)) return true;
    if (node.role === 'heading' && node.name && /gerelateerde zoek|related search|hulp nodig|need help/i.test(node.name)) return true;
    return false;
  }

  function isSkippable(node) {
    return node.role === 'dialog' && node.name && /filter/i.test(node.name);
  }

  const FILTER_GROUP = /toepassen om de resultaten|filter.*to narrow|apply.*filter|refine by/i;

  function dropFilterGroups(node) {
    if (!node) return null;
    if (node.role === 'group' && node.name && FILTER_GROUP.test(extractTextFromNode(node))) return null;
    node = { ...node, children: (node.children || []).map((c) => dropFilterGroups(c)).filter(Boolean) };
    if (STRUCTURAL.has(node.role) && !node.name && node.children.length === 0) return null;
    return node;
  }

  // --- Pruning helpers ---

  function hasInteractive(node) {
    if (INTERACTIVE.has(node.role) || GROUPS.has(node.role)) return true;
    return (node.children || []).some((c) => hasInteractive(c));
  }

  function hasHeading(node) {
    if (node.role === 'heading') return true;
    return (node.children || []).some((c) => hasHeading(c));
  }

  function extractTextFromNode(node) {
    let text = node.name || '';
    for (const child of (node.children || [])) text += ' ' + extractTextFromNode(child);
    return text;
  }

  function flattenNodes(nodes) {
    const result = [];
    for (const n of nodes) {
      result.push(n);
      if (n.children) result.push(...flattenNodes(n.children));
    }
    return result;
  }

  function condenseCard(node) {
    const all = flattenNodes([node]);
    const link = all.find((n) => n.role === 'link' && n.name);
    if (!link) return null;
    return {
      nodeId: node.nodeId, role: 'listitem', name: '', properties: {},
      ignored: false, children: [{ ...link, children: [] }],
    };
  }

  function collapseColors(node) {
    const all = flattenNodes([node]);
    const colors = all.filter((n) => n.role === 'link' && n.name && !n.name.startsWith('+'))
      .map((n) => n.name);
    if (colors.length === 0) {
      const plus = all.find((n) => n.role === 'link' && n.name);
      return plus ? { ...plus, children: [] } : null;
    }
    return {
      nodeId: node.nodeId, role: 'StaticText', name: `colors(${colors.length}): ${colors.join(', ')}`,
      properties: {}, ignored: false, children: [],
    };
  }

  // --- ARIA tree formatter (from barebrowse/src/aria.js) ---

  function formatTree(node, depth = 0) {
    if (!node) return '';
    if (node.ignored) {
      return (node.children || []).map((c) => formatTree(c, depth)).filter(Boolean).join('\n');
    }
    const SKIP = new Set(['InlineTextBox', 'LineBreak']);
    if (SKIP.has(node.role)) return '';

    // Promote: splice children in at current depth
    if (node.role === '_promote') {
      return (node.children || []).map((c) => formatTree(c, depth)).filter(Boolean).join('\n');
    }

    const indent = '  '.repeat(depth);
    const lines = [];

    let line = `${indent}- ${node.role || 'none'}`;
    if (node.name) line += ` "${node.name}"`;

    const props = node.properties || {};
    const propParts = [];
    if (props.checked !== undefined) propParts.push(`checked=${props.checked}`);
    if (props.disabled) propParts.push('disabled');
    if (props.expanded !== undefined) propParts.push(`expanded=${props.expanded}`);
    if (props.level) propParts.push(`level=${props.level}`);
    if (props.selected) propParts.push('selected');
    if (props.required) propParts.push('required');
    if (props.value !== undefined && props.value !== '') propParts.push(`value="${props.value}"`);
    if (props.url) propParts.push(`url="${props.url}"`);

    if (propParts.length > 0) line += ` [${propParts.join(', ')}]`;

    lines.push(line);

    for (const child of (node.children || [])) {
      const childText = formatTree(child, depth + 1);
      if (childText) lines.push(childText);
    }

    return lines.join('\n');
  }

  /* ══════════════════════════════════════════════════════════════
     SITE SEARCH DETECTION
     ══════════════════════════════════════════════════════════════ */

  function detectSiteSearch() {
    // Check for visible search inputs
    const searchInputs = document.querySelectorAll(
      'input[type="search"], input[name*="search"], input[name*="query"], input[name="q"], ' +
      'input[placeholder*="search" i], input[placeholder*="zoek" i], input[placeholder*="suche" i], ' +
      'input[aria-label*="search" i], input[aria-label*="zoek" i], ' +
      '[role="search"] input, [role="searchbox"]'
    );
    if (searchInputs.length > 0) return true;

    // Check for search links/buttons/icons (SPAs that JS-render the input)
    const searchElements = document.querySelectorAll(
      'a[href*="/search"], a[href*="search?"], button[aria-label*="search" i], ' +
      'button[aria-label*="zoek" i], [role="search"], form[action*="search"], ' +
      '[class*="search" i], [id*="search" i], [data-testid*="search" i], ' +
      '[class*="zoek" i]'
    );
    // Filter to only meaningful matches (not every div with "search" in class)
    for (const el of searchElements) {
      const tag = el.tagName;
      if (tag === 'A' || tag === 'BUTTON' || tag === 'FORM' || tag === 'INPUT' ||
          el.getAttribute('role') === 'search' ||
          el.querySelector('svg, img') || // icon buttons
          el.closest('header, nav')) { // search in header/nav area
        return true;
      }
    }

    return false;
  }

  // Try to figure out the site's search URL pattern
  function getSearchUrl(query) {
    // 1. Check for a form with search action
    const forms = document.querySelectorAll('form[action*="search"], [role="search"] form, form:has(input[type="search"])');
    for (const form of forms) {
      const action = form.action || form.getAttribute('action');
      if (action) {
        const input = form.querySelector('input[type="search"], input[name="q"], input[name*="query"], input[name*="search"]');
        const paramName = input?.name || 'q';
        try {
          const url = new URL(action, location.origin);
          url.searchParams.set(paramName, query);
          return url.href;
        } catch { /* skip */ }
      }
    }

    // 2. Check for search links in the page
    const searchLink = document.querySelector('a[href*="/search"]');
    if (searchLink) {
      try {
        const url = new URL(searchLink.href, location.origin);
        url.searchParams.set('q', query);
        return url.href;
      } catch { /* skip */ }
    }

    // 3. Try locale-prefixed search path (e.g. /nl-nl/search, /en-us/search)
    const localeMatch = location.pathname.match(/^(\/[a-z]{2}(-[a-z]{2})?)\b/i);
    if (localeMatch) {
      return location.origin + localeMatch[1] + '/search?q=' + encodeURIComponent(query);
    }

    // 4. Common patterns: /search?q=
    return location.origin + '/search?q=' + encodeURIComponent(query);
  }

  /* ══════════════════════════════════════════════════════════════
     PAGE EXTRACTION — builds ARIA tree, prunes, formats
     ══════════════════════════════════════════════════════════════ */

  function extractLinksFromTree(node) {
    const links = [];
    if (!node) return links;
    if (node.role === 'link' && node.properties?.url && node.name) {
      links.push({ text: node.name.slice(0, 150), url: node.properties.url });
    }
    for (const child of (node.children || [])) {
      links.push(...extractLinksFromTree(child));
    }
    return links;
  }

  function extractCurrentPage() {
    const rawTree = buildAriaTree(document.body);
    const pruned = prune(rawTree, { mode: 'full', context: '' });
    const yaml = pruned ? formatTree(pruned) : '';

    // Extract clean link list with real URLs (deduped)
    const allLinks = extractLinksFromTree(rawTree);
    const seen = new Set();
    const links = [];
    for (const link of allLinks) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }

    return {
      url: location.href,
      title: document.title,
      ariaTree: yaml.slice(0, 15000),
      links,
      hasSearch: detectSiteSearch(),
    };
  }

  /* ══════════════════════════════════════════════════════════════
     MESSAGE HANDLING — respond to requests from side panel / background
     ══════════════════════════════════════════════════════════════ */

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getPageData') {
      const pageData = extractCurrentPage();
      // Include search URL builder for asksite
      pageData._searchUrl = getSearchUrl('__QUERY__');
      sendResponse({ pageData });
      return false;
    }

    if (msg.type === 'getPageInfo') {
      sendResponse({
        hasSearch: detectSiteSearch(),
        url: location.href,
        title: document.title,
      });
      return false;
    }

    return false;
  });

})();
