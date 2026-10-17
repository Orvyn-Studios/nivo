import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const out=new URL('../artifacts/music-polish/',import.meta.url);
const png=async name=>`data:image/png;base64,${(await readFile(new URL(`${name}.png`,out))).toString('base64')}`;
const report=JSON.parse(await readFile(new URL('validation.json',out),'utf8'));
const browser=await chromium.launch({headless:true,chromiumSandbox:true});
const page=await browser.newPage({viewport:{width:1260,height:900},deviceScaleFactor:1});
const css='*{box-sizing:border-box}body{margin:0;padding:36px;background:#e9ebef;color:#20252e;font:14px Segoe UI,Arial,sans-serif}h1{font-size:26px;letter-spacing:-.7px;margin:0 0 8px}p{color:#596474;margin:0 0 24px}main{display:grid;gap:20px;grid-template-columns:repeat(3,1fr)}article{border:1px solid #d7dce3;border-radius:18px;background:#f8f9fb;padding:18px;min-height:235px}h2{font-size:13px;margin:0 0 16px}img{display:block;max-width:100%;height:auto}small{display:block;color:#596474;font-size:12px;margin-top:16px;line-height:1.6}';
async function render(name,title,subtitle,cards,columns=3){
  await page.setViewportSize({width:1260,height:columns===2?470:900});
  const html=`<!doctype html><meta charset=utf-8><style>${css}main{grid-template-columns:repeat(${columns},1fr)}</style><h1>${title}</h1><p>${subtitle}</p><main>${(await Promise.all(cards.map(async([file,label,note=''])=>`<article><h2>${label}</h2><img src="${await png(file)}"><small>${note}</small></article>`))).join('')}</main>`;
  await writeFile(new URL(`${name}.html`,out),html);
  await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
  await page.screenshot({path:fileURLToPath(new URL(`${name}.png`,out)),fullPage:true});
}
try{
  await render('Antes-despues','Nivo Music · antes y después','Misma interfaz y datos de prueba. Capturas del código anterior 297d3a0 y del nuevo reproductor.',[
    ['antes-expandido','Antes · 360 × 202 DIP','Acciones en otra fila y duración desplazada hacia el centro.'],
    ['02-reproduciendo-sin-portada','Después · 360 × 172 DIP','Una sola fila de controles, acciones compartidas y tiempos alineados con la barra.'],
  ],2);
  await render('Revision-visual','Nivo Music · revisión visual','Datos GSMTC simulados exclusivamente para las pruebas. Selector omitido por confirmación del usuario.',report.screenshots.map(name=>[name,name.replace(/^\d+-/,'').replaceAll('-',' ')]));
}finally{await browser.close()}
