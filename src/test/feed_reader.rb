#!/usr/bin/env ruby
# frozen_string_literal: true

require "feedjira"
require "faraday"

FEED_URL = "https://thefocus.ai/rss.xml"

def fetch_feed(url)
  response = Faraday.get(url)

  if response.success?
    response.body
  else
    raise "Failed to fetch feed: HTTP #{response.status}"
  end
rescue Faraday::Error => e
  raise "Network error: #{e.message}"
end

def parse_feed(xml)
  Feedjira.parse(xml)
rescue Feedjira::NoParserAvailable => e
  raise "Could not parse feed: #{e.message}"
end

def display_entries(feed)
  puts "=" * 60
  puts "Feed: #{feed.title}"
  puts "URL: #{feed.url}" if feed.respond_to?(:url) && feed.url
  puts "=" * 60
  puts

  if feed.entries.empty?
    puts "No entries found."
    return
  end

  feed.entries.each_with_index do |entry, index|
    puts "#{index + 1}. #{entry.title}"
    puts "   Published: #{entry.published}" if entry.published
    puts "   URL: #{entry.url}" if entry.url
    puts "   Summary: #{truncate(entry.summary, 150)}" if entry.summary
    puts
  end
end

def truncate(text, length)
  return nil if text.nil?

  clean_text = text.gsub(/<[^>]+>/, "").gsub(/\s+/, " ").strip

  if clean_text.length > length
    "#{clean_text[0, length]}..."
  else
    clean_text
  end
end

def main
  puts "Fetching latest posts from thefocus.ai..."
  puts

  xml = fetch_feed(FEED_URL)
  feed = parse_feed(xml)
  display_entries(feed)
rescue StandardError => e
  puts "Error: #{e.message}"
  exit 1
end

main
