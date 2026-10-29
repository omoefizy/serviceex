// Sample content for the empty states, so a first run can try the app before typing anything in. All of it is in the
// public domain.

import { DEFAULT_ARRANGEMENT } from '../../shared/lyrics'
import type { AnnouncementPayload, SongInput } from '../../shared/types'

export const SAMPLE_SONG: SongInput = {
  title: 'Amazing Grace',
  author: 'John Newton',
  copyright: 'Public domain',
  tags: ['sample', 'hymn'],
  arrangement: DEFAULT_ARRANGEMENT,
  themeId: null,
  lyrics: `[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!
I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;
'Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
When we've been there ten thousand years,
Bright shining as the sun,
We've no less days to sing God's praise
Than when we'd first begun.`,
}

export const SAMPLE_WELCOME: AnnouncementPayload = {
  title: 'Welcome',
  body: 'We are glad you are here\n\nPlease silence your phone as we begin',
  titleSlide: true,
}

/** The sample song, added once: a second click finds the one already there. */
export async function addSampleSong() {
  const existing = (await window.api.songs.list(SAMPLE_SONG.title)).find((s) => s.title === SAMPLE_SONG.title)
  return existing ? ((await window.api.songs.get(existing.id)) ?? null) : window.api.songs.create(SAMPLE_SONG)
}

/** Fired on window to show a library tab, such as from the schedule's empty state. */
export const SHOW_LIBRARY_TAB_EVENT = 'serviceex:show-library-tab'

export function showLibraryTab(tab: 'songs' | 'scripture' | 'presentations' | 'media'): void {
  window.dispatchEvent(new CustomEvent(SHOW_LIBRARY_TAB_EVENT, { detail: tab }))
}
