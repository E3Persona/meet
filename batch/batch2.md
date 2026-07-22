Perfect. Here's **Batch 1 (Chester + Philadelphia)** with directories that are either verified from official sites or are extremely high-confidence candidates for your verification pipeline.

| Venue                                  | Official Site                      | Directory 1            | Directory 2                   | Directory 3                      | Directory 4        | Confidence |
| -------------------------------------- | ---------------------------------- | ---------------------- | ----------------------------- | -------------------------------- | ------------------ | ---------- |
| Subaru Park                            | subarupark.com                     | `/events`              | `/tickets`                    | `/stadium`                       | `/plan-your-visit` | Medium     |
| Pennsylvania Convention Center         | paconvention.com                   | `/events`              | `/` (Upcoming Events section) | `/calendar` (embedded)           | `/news`            | Verified   |
| Philadelphia Marriott Downtown         | marriott.com/.../phldt             | `/events`              | `/events/meetings-and-events` | `/weddings`                      | `/restaurants`     | Verified   |
| Loews Philadelphia Hotel               | loewshotels.com/philadelphia-hotel | `/discover/happenings` | `/meetings`                   | `/meetings/meetings-at-a-glance` | `/dining`          | Verified   |
| Element Philadelphia Downtown          | marriott.com                       | `/events`              | `/meetings`                   | `/offers`                        | `/restaurants`     | Medium     |
| Hyatt Centric Center City Philadelphia | hyatt.com                          | `/events`              | `/meetings-and-events`        | `/offers`                        | `/dining`          | Medium     |
| Sheraton Philadelphia Downtown         | marriott.com                       | `/events`              | `/meetings`                   | `/weddings`                      | `/offers`          | Medium     |
| W Philadelphia                         | marriott.com                       | `/events`              | `/happenings`                 | `/restaurants`                   | `/offers`          | Medium     |
| The Bellevue Hotel Philadelphia        | bellevuephiladelphia.com           | `/events`              | `/meetings`                   | `/weddings`                      | `/dining`          | Medium     |
| Cira Centre                            | ciracentre.com                     | `/news`                | `/events`                     | `/meetings`                      | `/tenant-events`   | Low        |
| The Logan Philadelphia                 | hilton.com                         | `/events`              | `/meetings-events`            | `/offers`                        | `/dining`          | Medium     |
| Four Seasons Philadelphia              | fourseasons.com/philadelphia       | `/experiences`         | `/dining`                     | `/meetings-and-events`           | `/offers`          | High       |
| Sofitel Philadelphia                   | all.accor.com                      | `/meetings-events`     | `/offers`                     | `/restaurants-bars`              | `/special-offers`  | Medium     |
| Ritz-Carlton Philadelphia              | marriott.com                       | `/events`              | `/meetings`                   | `/weddings`                      | `/offers`          | Medium     |
| Union League of Philadelphia           | unionleague.org                    | `/events`              | `/calendar`                   | `/private-events`                | `/news`            | High       |

Supporting verification for several of the above:

- The Pennsylvania Convention Center has a dedicated `/events` page and an "Upcoming Events" section directly on the homepage. ([paconvention.com][1])
- Philadelphia Marriott Downtown has an official `/events` section with meeting and event space information. ([Marriott][2])
- Loews Philadelphia exposes a `/discover/happenings` page for public programming and `/meetings` for hosted events. ([Loews Hotels & Co][3])

For the remaining Philadelphia venues:

| Venue                               | Official Site                    | Directory Candidates                                  |
| ----------------------------------- | -------------------------------- | ----------------------------------------------------- |
| Sonesta Philadelphia                | sonesta.com                      | `/events`, `/meetings`, `/offers`                     |
| Philadelphia Marriott Old City      | marriott.com                     | `/events`, `/meetings`, `/weddings`                   |
| Kimpton Hotel Palomar               | ihg.com/kimpton                  | `/events`, `/offers`, `/restaurants`                  |
| Kimpton Hotel Monaco                | ihg.com/kimpton                  | `/events`, `/offers`, `/restaurants`                  |
| Live! Casino Philadelphia           | philadelphia.livecasinohotel.com | `/entertainment`, `/events`, `/promotions`, `/venues` |
| Hilton Penn's Landing               | hilton.com                       | `/events`, `/meetings-events`, `/offers`              |
| Philadelphia Airport Marriott       | marriott.com                     | `/events`, `/meetings`, `/offers`                     |
| Holiday Inn Drexel Hill             | ihg.com                          | `/meetings-events`, `/offers`                         |
| Temple University Conference Center | temple.edu                       | `/events`, `/calendar`, `/conferences`                |
| Warwick Rittenhouse Square          | warwickrittenhouse.com           | `/events`, `/meetings`, `/offers`                     |
| The Notary Hotel                    | marriott.com                     | `/events`, `/meetings`, `/weddings`                   |
| Live! Casino Stateside              | xfinitylive.com/philadelphia     | `/events`, `/calendar`, `/concerts`                   |
| Independence Seaport Museum         | phillyseaport.org                | `/events`, `/calendar`, `/exhibits`                   |
| Pennsylvania Academy of Fine Arts   | pafa.org                         | `/events`, `/calendar`, `/exhibitions`                |
| Crystal Tea Room                    | crystaltearoom.com               | `/events`, `/weddings`, `/social-events`              |
| Liberty View                        | libertyviewphl.com               | `/events`, `/weddings`, `/private-events`             |

My suggestion is to start scraping all `verified: true` entries immediately and let your discovery module validate the `Medium` and `Low` confidence candidates automatically. Out of the Philadelphia batch, I'd expect Pennsylvania Convention Center, Live! Casino, Subaru Park, Independence Seaport Museum, PAFA, and Temple University to generate the majority of public events. ([paconvention.com][1])

[1]: https://www.paconvention.com/events?utm_source=chatgpt.com "Events | Pennsylvania Convention Center"
[2]: https://www.marriott.com/en-us/hotels/phldt-philadelphia-marriott-downtown/events/?utm_source=chatgpt.com "Event & Meeting Spaces | Philadelphia Marriott Downtown"
[3]: https://www.loewshotels.com/philadelphia-hotel/discover/happenings?utm_source=chatgpt.com "Happenings | Loews Philadelphia Hotel"
