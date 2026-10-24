Place a licensed, current `GeoLite2-City.mmdb` here to enable approximate
country/city lookup for configured access-audit events. The database is not
committed or baked into the Docker image. If no database is present, access
events still record the IP address, but location fields remain empty.
