const paths: Record<string, string> = {
  file:'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8m-8 4h6',
  archive:'M4 3h16v18H4z M10 3v3h4V3m-4 6h4m-4 3h4m-4 3h4v3h-4z',
  image:'M3 3h18v18H3z M3 17l5-5 4 4 3-3 6 6 M15 8h.01',
  sound: 'm4 9 4 0 5-4v14l-5-4H4z M17 8q4 4 0 8 M17 4q8 8 0 16',
  microphone: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M6 11v1a6 6 0 0 0 12 0v-1 M12 18v4 M8 22h8',
  device: 'M4 13V9a8 8 0 0 1 16 0v4 M4 12h3v7H4z M17 12h3v7h-3z',
  keyboard: 'M3 6h18v12H3z M6 10h1m3 0h1m3 0h1m3 0h.1 M7 14h10',
  battery: 'M3 7h16v10H3z M22 10v4 M7 10v4m4-4v4m4-4v4',
  download: 'M12 3v12m-5-5 5 5 5-5 M4 17v4h16v-4',
  agent: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  close: 'm7 7 10 10M17 7 7 17', check: 'm5 12 4 4L19 6', notice: 'M12 8v5m0 4h.01 M12 2 2 21h20z',
};
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name === 'volume' ? 'sound' : name] ?? paths.notice!); svg.append(path); return svg;
}
export function mountIcons(): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-icon]')) element.replaceChildren(icon(element.dataset.icon!));
}
