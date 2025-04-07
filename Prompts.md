# Blinkit's parsing prompts

I'm not able to fetch the relevant top blinkist result.
In order to be able to get there, first the list of results including the ones having ads.

The below XPath gives the list of all of them

```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]
```

Of the list, the first is the result heading that needs to be ignored. 
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[1]
```

There are optional ads tiles that follow next, in this example there are two. But in real world there could be none or more. 
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[2]
```
and 
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[3]
```

The way to identify them is that they have the Ad Tag div with a style that identifies them that it's an Ad.

The first ad tag is below:
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[2]/div/div[2]/div[2]
```
with style having
```
    top: 6px;
    right: 6px;
```

The second ad's XPath Ad tag is below:
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[3]/div/div[1]/div[2]
```
with style having
```
    top: 6px;
    right: 6px;
```

If that is not the case, we've reached the desired card. In this case, below is the XPath:
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[4]
```

Now, once we reached the desired card, we'd want to parse the text and the price

The Xpath for product name is :
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[4]/div/div[2]/div[2]/div[1]/div[1]/div
```
The corrsponding text is retrieved from it's innerText

The Xpath for price is:
```
/html/body/div[1]/div/div/div[3]/div/div/div[2]/div[1]/div/div/div[2]/div[4]/div/div[2]/div[2]/div[2]/div/div[1]
```
The corrsponding text is retrieved from it's innerText