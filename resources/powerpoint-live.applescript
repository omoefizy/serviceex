-- Live PowerPoint for ServiceEx on macOS: plays a private copy of a presentation (never the operator's
-- original) as a slide show over the output display. ServiceEx runs it through osascript once per command:
--   running                                      whether PowerPoint is running
--   open <copy>                                  opens the copy (if it is not open yet); prints the slide count
--   start <copy> <slide> <timings> <x> <y> <w> <h>  ends its show, starts one from <slide> to the end over those
--                                                bounds, and brings PowerPoint forward so macOS shows it
--   build <copy> <clicks>                        clicks through the slide shown, without waiting for effects
--   next | previous | position | pause | resume | end <copy>
--   close <copy>                                 ends its show and closes it without saving
--   quit                                         quits PowerPoint when no presentation is open in it
-- Show commands print "<slide index>|<state>|<left>,<top>,<width>,<height>", or "none" when no show is running.
-- PowerPoint for Mac cannot go to a slide inside a running show (go to slide fails with -50), so ServiceEx
-- starts the show again from that slide instead.

on run argv
	set commandName to item 1 of argv
	if commandName is "running" then return (application id "com.microsoft.Powerpoint" is running) as text
	if commandName is "quit" then
		if application id "com.microsoft.Powerpoint" is running then
			tell application id "com.microsoft.Powerpoint"
				-- Never closes anything the operator has open, saved or not.
				if (count of presentations) is 0 then quit saving no
			end tell
		end if
		return "ok"
	end if
	set deckPath to item 2 of argv
	with timeout of 20 seconds
		tell application id "com.microsoft.Powerpoint"
			if commandName is "open" then
				set deck to my findDeck(deckPath)
				if deck is missing value then
					open POSIX file deckPath
					set deck to my findDeck(deckPath)
				end if
				if deck is missing value then error "PowerPoint did not open the copy." number -9074
				return (count of slides of deck) as text
			end if

			if commandName is "close" then
				set win to my findShow(deckPath)
				if win is not missing value then exit slide show (slideshow view of win)
				set deck to my findDeck(deckPath)
				if deck is not missing value then close deck saving no
				return "ok"
			end if

			if commandName is "start" then
				set deck to my findDeck(deckPath)
				if deck is missing value then error "The copy is not open in PowerPoint." number -1728
				set win to my findShow(deckPath)
				if win is not missing value then exit slide show (slideshow view of win)
				-- PowerPoint plays the show on the display its document window is on: move that onto the output.
				try
					set left position of document window 1 of deck to ((item 5 of argv) as real) + 40
					set top of document window 1 of deck to ((item 6 of argv) as real) + 40
				end try
				set showSettings to slide show settings of deck
				-- Full screen (speaker) is the show that covers a display exactly; the window type has a title bar,
				-- which macOS keeps below the menu bar.
				set show type of showSettings to slide show type speaker
				try
					set show with presenter of showSettings to false
				end try
				if item 4 of argv is "1" then
					set advance mode of showSettings to slide show advance use slide timings
				else
					set advance mode of showSettings to slide show advance manual advance
				end if
				set loop until stopped of showSettings to false
				set range type of showSettings to slide show range
				set starting slide of showSettings to (item 3 of argv) as integer
				set ending slide of showSettings to (count of slides of deck)
				set win to run slide show showSettings
				set left position of win to (item 5 of argv) as real
				set top of win to (item 6 of argv) as real
				set width of win to (item 7 of argv) as real
				set height of win to (item 8 of argv) as real
				-- No pointer, and so no slide show toolbar, on the output.
				try
					set pointer type of (slideshow view of win) to slide show pointer always hidden
				end try
				-- The full screen show is a space of its own; macOS shows it only once PowerPoint is brought forward.
				-- ServiceEx takes the keyboard back straight after.
				activate
				return my describe(win)
			end if

			set win to my findShow(deckPath)
			if win is missing value then return "none"
			set showView to slideshow view of win
			-- A click sent while a transition plays can be lost, so let the one playing finish first.
			if commandName is in {"next", "previous", "build"} then my settle(showView)
			if commandName is "next" then
				go to next slide showView
				-- Past the last slide PowerPoint shows "End of slide show"; step back onto the last slide instead.
				if slide state of showView is slide show state done then go to previous slide showView
			else if commandName is "previous" then
				go to previous slide showView
			else if commandName is "build" then
				repeat ((item 3 of argv) as integer) times
					go to next slide showView
				end repeat
			else if commandName is "pause" then
				set slide state of showView to slide show state paused
			else if commandName is "resume" then
				set slide state of showView to slide show state running
			else if commandName is "end" then
				exit slide show showView
				return "none"
			end if
			return my describe(win)
		end tell
	end timeout
end run

-- Waits (up to 2 seconds) for a transition to finish; the show position reads 0 while one plays.
on settle(showView)
	tell application id "com.microsoft.Powerpoint"
		repeat 40 times
			try
				if (current show position of showView) is not 0 then exit repeat
			on error
				exit repeat
			end try
			delay 0.05
		end repeat
	end tell
end settle

on findDeck(deckPath)
	tell application id "com.microsoft.Powerpoint"
		repeat with deckNumber from 1 to (count of presentations)
			set deck to presentation deckNumber
			if full name of deck is deckPath then return deck
		end repeat
	end tell
	return missing value
end findDeck

on findShow(deckPath)
	tell application id "com.microsoft.Powerpoint"
		repeat with windowNumber from 1 to (count of slide show windows)
			set win to slide show window windowNumber
			if full name of (presentation of win) is deckPath then return win
		end repeat
	end tell
	return missing value
end findShow

on describe(win)
	tell application id "com.microsoft.Powerpoint"
		set showView to slideshow view of win
		set showState to slide state of showView
		if showState is slide show state done then
			set stateName to "done"
		else if showState is slide show state paused then
			set stateName to "paused"
		else
			set stateName to "running"
		end if
		set slideNumber to 0
		try
			set slideNumber to slide index of (slide of showView)
		end try
		set frameText to ((left position of win) as text) & "," & ((top of win) as text) & "," & ((width of win) as text) & "," & ((height of win) as text)
		return (slideNumber as text) & "|" & stateName & "|" & frameText
	end tell
end describe
