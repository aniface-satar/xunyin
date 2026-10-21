import Event from '@/event/Event'

class DownloadEvent extends Event {
  download_changed() {
    this.emit('download_changed')
  }
}

type EventMethods = Omit<EventType, keyof Event>

declare class EventType extends DownloadEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

type DownloadEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>

export const event: DownloadEventTypes = new DownloadEvent()
