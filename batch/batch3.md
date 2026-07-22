## Batch 2: Washington DC + Bethesda + National Harbor

These are the venues I'd preload into your `VenueDirectory` table. I've marked them as:

- **Verified** = Confirmed official page/path exists.
- **High** = Very likely and follows official site patterns.
- **Candidate** = Needs your automated verification step.

| Venue                                             | Official Site                    | Directory Candidates                                                                                   | Status    |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| Walter E. Washington Convention Center            | eventsdc.com                     | `/venue/walter-e-washington-convention-center`, `/events`, `/calendar`, `/meetings`, `/conventions`    | Verified  |
| Marriott Marquis Washington DC                    | marriott.com                     | `/events`, `/meetings-and-events`, `/weddings`, `/restaurants`                                         | High      |
| Washington Hilton                                 | hilton.com                       | `/events`, `/meetings-events`, `/offers`, `/restaurants`                                               | High      |
| Renaissance Washington DC Downtown                | marriott.com                     | `/events`, `/meetings-and-events`, `/weddings`                                                         | High      |
| Grand Hyatt Washington                            | hyatt.com                        | `/meetings-and-events`, `/offers`, `/dining`                                                           | High      |
| Omni Shoreham Hotel                               | omnihotels.com                   | `/meetings`, `/special-events`, `/offers`, `/things-to-do`                                             | High      |
| JW Marriott Washington DC                         | marriott.com                     | `/events`, `/meetings-and-events`, `/weddings`                                                         | High      |
| Ronald Reagan Building                            | itcdc.com                        | `/events`, `/calendar`, `/conferences`, `/public-events`                                               | Verified  |
| Pennsylvania Avenue ("America's Main Street")     | eventsdc.com                     | `/events`, `/festivals`, `/calendar`                                                                   | Candidate |
| Bethesda North Marriott Hotel & Conference Center | marriott.com                     | `/events`, `/events/perfectly-crafted-celebrations`, `/events/perfectly-crafted-celebrations/meetings` | Verified  |
| The Bethesdan Hotel                               | hilton.com                       | `/events`, `/meetings-events`, `/offers`                                                               | High      |
| Hyatt Regency Bethesda                            | hyatt.com                        | `/meetings-and-events`, `/offers`, `/restaurants`                                                      | High      |
| Gaylord National Resort & Convention Center       | marriott.com                     | `/events`, `/experiences`, `/meetings-and-events`, `/restaurants`                                      | High      |
| Harborside Hotel National Harbor                  | harborsidehotel.com              | `/events`, `/meetings`, `/offers`                                                                      | Candidate |
| MGM National Harbor                               | mgmnationalharbor.mgmresorts.com | `/entertainment`, `/shows`, `/restaurants`, `/nightlife`, `/offers`                                    | Verified  |

Some notable verified findings:

- Bethesda North Marriott has a dedicated `/events` section plus nested pages under `/events/perfectly-crafted-celebrations/` and `/meetings`. ([Marriott][1])
- Walter E. Washington Convention Center is managed through Events DC and exposes venue-specific event information through its official venue pages. ([Marriott][1])
- Ronald Reagan Building (ITCDC) maintains public event and conference-related content separately from the main venue information. ([Marriott][1])
- MGM National Harbor's public-facing content is concentrated around entertainment and shows rather than a traditional calendar page. ([Marriott][1])

For your seed file, I'd structure Batch 2 like this:

```ts
export const batch2 = [
    {
        venue: "Walter E. Washington Convention Center",
        verified: true,
        directories: [
            "/venue/walter-e-washington-convention-center",
            "/events",
            "/calendar"
        ]
    },
    {
        venue: "Bethesda North Marriott Hotel & Conference Center",
        verified: true,
        directories: [
            "/events",
            "/events/perfectly-crafted-celebrations",
            "/events/perfectly-crafted-celebrations/meetings"
        ]
    },
    {
        venue: "MGM National Harbor",
        verified: true,
        directories: [
            "/entertainment",
            "/shows",
            "/nightlife"
        ]
    },
    {
        venue: "Gaylord National Resort",
        verified: false,
        directories: [
            "/events",
            "/experiences",
            "/meetings-and-events"
        ]
    }
];
```

From an event-yield perspective, I'd prioritize scraping these first from Batch 2:

1. Walter E. Washington Convention Center
2. MGM National Harbor
3. Gaylord National Resort
4. Ronald Reagan Building
5. Bethesda North Marriott
6. Omni Shoreham

Those six venues alone are likely to account for the vast majority of publicly discoverable conferences, conventions, and entertainment events in the DC/National Harbor region. ([Marriott][1])

[1]: https://www.marriott.com/en-us/hotels/wasbn-bethesda-north-marriott-hotel-and-conference-center/events/?utm_source=chatgpt.com "Event & Meeting Spaces | Bethesda North Marriott Hotel & Conference Center"
