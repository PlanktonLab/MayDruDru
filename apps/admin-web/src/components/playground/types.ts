/**
 * The chat transcript as the room shows it. Free of admin concerns so the
 * room can become the public web widget later (SPEC §10).
 */
export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  kind: 'text' | 'image' | 'choices'
  text?: string
  url?: string
  previewUrl?: string
  alt?: string
  /** `choices`: the answers the citizen can tap; picking one sends its label as a text message. */
  options?: { label: string }[]
  /** Assistant items carry the turn they came from, so the inspector can show that turn. */
  turnId?: string
  error?: boolean
}

export interface Outgoing { text: string; file: File | null }
