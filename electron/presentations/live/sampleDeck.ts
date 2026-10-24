// The sample deck for Test Live PowerPoint: three slides of invented text made with pptxgenjs, then given click
// animations and a fade transition by editing the slide XML, since pptxgenjs writes neither.

import { writeFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import PptxGenJS from 'pptxgenjs'

/** Each slide: a title, and lines that appear one click at a time (none on a still slide). */
const SLIDES: { title: string; lines: string[]; transition: boolean }[] = [
  { title: 'Live PowerPoint test', lines: ['First click: this line fades in', 'Second click: and this one', 'Third click: the last line'], transition: false },
  { title: 'Fade transition', lines: ['One click brings this in'], transition: true },
  { title: 'The end', lines: [], transition: true },
]

/** The click steps the sample has on each slide, for checking what the controller reports. */
export const SAMPLE_STEPS = SLIDES.map((slide) => slide.lines.length)

/** One fade-in entrance per shape, each on its own click. */
function timingXml(shapeIds: number[]): string {
  let id = 2
  const clicks = shapeIds
    .map((spid) => {
      const [outer, inner, effect, set, fade] = [++id, ++id, ++id, ++id, ++id]
      return (
        `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
        `<p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
        `<p:par><p:cTn id="${effect}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">` +
        `<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
        `<p:set><p:cBhvr><p:cTn id="${set}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
        `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
        `<p:to><p:strVal val="visible"/></p:to></p:set>` +
        `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${fade}" dur="500"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
        `</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
      )
    })
    .join('')
  return (
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
    `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${clicks}</p:childTnLst></p:cTn>` +
    '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
    '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>' +
    '</p:childTnLst></p:cTn></p:par></p:tnLst>' +
    `<p:bldLst>${shapeIds.map((spid) => `<p:bldP spid="${spid}" grpId="0"/>`).join('')}</p:bldLst></p:timing>`
  )
}

/** Writes the sample deck to `file`. */
export async function writeAnimatedSample(file: string): Promise<void> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_16x9'
  for (const { title, lines } of SLIDES) {
    const slide = deck.addSlide()
    slide.background = { color: '1B2A4A' }
    slide.addText(title, { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 40, bold: true, color: 'FFFFFF' })
    lines.forEach((line, index) => slide.addText(line, { x: 0.8, y: 1.8 + index * 1, w: 8.4, h: 0.8, fontSize: 26, color: 'FFFFFF' }))
  }
  const files = unzipSync(new Uint8Array((await deck.write({ outputType: 'nodebuffer' })) as Buffer))
  SLIDES.forEach(({ lines, transition }, index) => {
    const part = `ppt/slides/slide${index + 1}.xml`
    let xml = strFromU8(files[part])
    // The title is the first shape; the lines follow it in order.
    const ids = [...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])).filter((id) => id > 1)
    const extra = (transition ? '<p:transition spd="med"><p:fade/></p:transition>' : '') + (lines.length > 0 ? timingXml(ids.slice(1, 1 + lines.length)) : '')
    // p:transition and p:timing come after p:clrMapOvr (or p:cSld when there is none), before p:extLst.
    xml = /<\/p:clrMapOvr>/.test(xml) ? xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${extra}`) : xml.replace('</p:cSld>', `</p:cSld>${extra}`)
    files[part] = strToU8(xml)
  })
  await writeFile(file, zipSync(files))
}
