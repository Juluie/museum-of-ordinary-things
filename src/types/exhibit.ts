/** Публичный экспонат — ровно те поля, которые отдаёт сервер посетителю. */
export type Exhibit = {
  id: string
  number: number
  title: string
  story: string
  authorName: string | null
  keptSince: string | null
  imageAlt: string
  imageUrl: string
  imageWidth: number | null
  imageHeight: number | null
  imageUrlExpiresAt?: string
}

export type ExhibitStatus = 'pending' | 'approved' | 'rejected'

export type AdminExhibit = Omit<Exhibit, 'number' | 'imageUrl' | 'imageWidth' | 'imageHeight'> & {
  number: number | null
  status: ExhibitStatus
  createdAt: string
  approvedAt: string | null
  imageUrl: string | null
}
