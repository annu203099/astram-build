# Sinatra-style search route (CVE-2026-110264 shape): user-controlled
# params[:q] flows into Regexp.compile without escaping.
require 'sinatra'
require 'json'

get '/search' do
  pattern = Regexp.compile(params[:q])
  matches = File.readlines('data/log.txt').grep(pattern)
  content_type :json
  { matches: matches.first(20) }.to_json
end
