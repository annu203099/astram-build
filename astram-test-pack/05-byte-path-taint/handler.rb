def route_request(user_input)
  # Untrusted user_input compiled directly into a regular expression
  pattern = Regexp.new(user_input)
  pattern.match(some_internal_string)
end
