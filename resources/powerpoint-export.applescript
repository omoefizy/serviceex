-- Exports a presentation to PDF with Microsoft PowerPoint for Mac. ServiceEx runs this through osascript with
-- the path of a private copy of the presentation (never the operator's original) and the PDF to write.
-- PowerPoint is quit afterwards only when this script launched it.
on run argv
	set inputPath to item 1 of argv
	set outputPath to item 2 of argv
	set wasRunning to application id "com.microsoft.Powerpoint" is running
	set errorText to ""
	set errorNumber to 0
	with timeout of 110 seconds
		tell application id "com.microsoft.Powerpoint"
			try
				open POSIX file inputPath
				set deck to active presentation
				save deck in POSIX file outputPath as save as PDF
				close deck saving no
			on error errText number errNum
				set errorText to errText
				set errorNumber to errNum
				try
					close active presentation saving no
				end try
			end try
			if not wasRunning then
				try
					quit saving no
				end try
			end if
		end tell
	end timeout
	if errorNumber is not 0 then error errorText number errorNumber
	return "ok"
end run
