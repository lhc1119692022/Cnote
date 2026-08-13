declare module 'mammoth/mammoth.browser' {
  interface ExtractResult { value: string }
  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractResult>
  }
  export default mammoth
  export = mammoth
}
