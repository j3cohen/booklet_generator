/** Which output sides get a 180° rotation applied to compensate for duplex quirks. */
export type RotationMode = 'back' | 'front' | 'none'

/** A 1-based source page number, or null for a blank slot. */
export type Slot = number | null

/** One physical sheet of paper: a front side and a back side, each [left, right]. */
export interface Sheet {
  front: [Slot, Slot]
  back: [Slot, Slot]
}

/** A group of sheets that nest together and are folded as one unit. */
export interface Signature {
  /** 1-based index of the first source page covered by this signature. */
  firstPage: number
  sheets: Sheet[]
}

export interface BookletOptions {
  /** Sheets per signature. 0 (or undefined) means one single nested booklet. */
  sheetsPerSignature?: number
  rotation: RotationMode
}

/** One output page of the generated PDF, in order. */
export interface OutputSide {
  signatureIndex: number
  sheetIndex: number
  side: 'front' | 'back'
  slots: [Slot, Slot]
  rotated: boolean
}
