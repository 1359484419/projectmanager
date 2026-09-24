// 语音输入接口预留（spec §13）：本期只定义接口，返回 unsupported，麦克风按钮隐藏。
// 下期实现：MediaRecorder 录音 → POST /assistant/transcribe → 文本回填输入框（不自动发送）。
export interface VoiceInput {
  status: 'idle' | 'recording' | 'transcribing' | 'unsupported'
  start(): void
  stop(): void
  transcript: string
}

const UNSUPPORTED: VoiceInput = {
  status: 'unsupported',
  start() {},
  stop() {},
  transcript: '',
}

export function useVoiceInput(): VoiceInput {
  return UNSUPPORTED
}
