import {CalDavProvider, WindowsSystemCalendarProvider} from '@personal-agent/calendar';

export const SUPPORTED_CALENDAR_PROVIDER_KINDS = Object.freeze(['caldav', 'windows-system']);

/** Infers provider kind from a trusted binding, keeping legacy CalDAV bindings without providerKind working. */
export function inferCalendarProviderKind(binding) {
  if (!binding || typeof binding !== 'object') return undefined;
  if (typeof binding.providerKind === 'string') return binding.providerKind;
  return typeof binding.calendarUrl === 'string' && binding.calendarUrl ? 'caldav' : undefined;
}

/** Checks whether a trusted desktop calendar binding targets a supported backend. */
export function isSupportedCalendarBinding(binding) {
  return SUPPORTED_CALENDAR_PROVIDER_KINDS.includes(inferCalendarProviderKind(binding));
}

/** Resolves either Windows System Calendar or CalDAV provider from a trusted binding without duplicating branching. */
export function resolveCalendarProvider({
  binding,
  authorization,
  createCalendarProvider,
  createWindowsCalendarProvider,
  fetchImpl,
  now,
}) {
  const providerKind = inferCalendarProviderKind(binding);
  if (!SUPPORTED_CALENDAR_PROVIDER_KINDS.includes(providerKind)) {
    throw Error('日历配置未绑定或不受支持');
  }
  if (providerKind === 'windows-system') {
    const options = {
      ...(binding.calendarName ? {calendarName: binding.calendarName} : {}),
      ...(now ? {now} : {}),
    };
    return createWindowsCalendarProvider
      ? createWindowsCalendarProvider(options)
      : new WindowsSystemCalendarProvider(options);
  }
  const options = {
    calendarUrl: binding.calendarUrl,
    ...(binding.calendarName ? {calendarName: binding.calendarName} : {}),
    authorization,
    allowLoopbackHttp: true,
    ...(fetchImpl ? {fetchImpl} : {}),
    ...(now ? {now} : {}),
  };
  return createCalendarProvider
    ? createCalendarProvider(options)
    : new CalDavProvider(options);
}
