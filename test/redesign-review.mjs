/** Evidence board made from actual component screenshots; fixtures remain labelled. */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const folder=new URL('../artifacts/redesign/',import.meta.url);
const url=async path=>'data:image/png;base64,'+(await readFile(path)).toString('base64');
const entries=[['01-compacto','Reposo'],['02-hover','Curiosidad'],['03-calma','Al abrir'],['04-musica-compacta','Música compacta'],['05-musica','Música'],['06-volumen','Volumen'],['07-microfono','Micrófono'],['08-dispositivo','Dispositivo'],['09-caps-lock','Teclado'],['10-bateria','Batería'],['11-descarga','Descargando'],['12-descarga-lista','Descarga finalizada'],['13-codex-compacto','Codex compacto'],['14-codex-trabajando','Concentración'],['15-codex-listo','Codex finalizado'],['16-drop-destino','Arrastre'],['17-drop-archivo','Acciones de archivo'],['18-mezclador','Mezclador']];
let cards='';
for(const [name,label] of entries)cards+=`<figure><figcaption>${label}</figcaption><div><img src="${await url(new URL(name+'.png',folder))}"/></div></figure>`;
const styles='*{box-sizing:border-box}body{margin:0;padding:44px;background:#181b20;color:#f5f6f8;font:14px Segoe UI}h1{font-size:28px;font-weight:500;letter-spacing:-1px;margin:0 0 8px}p{color:#a1a5af;margin:0 0 30px}section{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;background:#202329;border:1px solid #30333a;border-radius:18px;padding:20px}figcaption{font-size:12px;color:#a1a5af;margin-bottom:18px}figure div{height:300px;display:grid;place-items:center}img{max-width:100%;height:auto}';
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
 await page.setContent(`<html lang="es"><style>${styles}</style><body><h1>Nivo · Una isla, distintos momentos.</h1><p>Revisión visual de componentes reales · eventos simulados exclusivamente para estas pruebas</p><section>${cards}</section></body></html>`);
 await page.screenshot({path:fileURLToPath(new URL('Revision-visual.png',folder)),fullPage:true});
 const before=await url(new URL('../redesign-before/island-expanded.png',folder));
 const after=await url(new URL('03-calma.png',folder));
 await page.setContent(`<html lang="es"><style>${styles}section{grid-template-columns:1fr 1fr}figure div{height:340px}.before{width:388px!important;height:320px!important;display:block!important;background-image:url('${before}');background-position:-356px -97px;background-repeat:no-repeat}</style><body><h1>Menos superficie. Más intención.</h1><p>Sin sesión musical · misma escala de píxeles CSS · capturas de navegador, no prueba de hardware</p><section><figure><figcaption>Antes · 388 × 320</figcaption><div><span class="before"></span></div></figure><figure><figcaption>Ahora · 260 × 138</figcaption><div><img src="${after}"/></div></figure></section></body></html>`);
 await page.screenshot({path:fileURLToPath(new URL('Antes-despues.png',folder))});
 await writeFile(new URL('review-method.txt',folder),'Contact sheets use real screenshot PNGs arranged in HTML at their original CSS pixel scale. The baseline crop is positioned at x=356,y=97 from the preserved 1100x720 screenshot. No external assets or generated product data.');
}finally{await browser.close();}
