<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:outline="http://wkhtmltopdf.org/outline"
                xmlns="http://www.w3.org/1999/xhtml">
  <xsl:output doctype-public="-//W3C//DTD XHTML 1.0 Strict//EN"
              doctype-system="http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd" indent="yes" />
  <xsl:template match="outline:outline">
    <html>
      <head>
        <title>Inhaltsverzeichnis</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <style>
          body { font-family: 'Inter', sans-serif; color: #1D1B20; margin: 0 6px; }
          h1 { font-size: 26px; font-weight: 600; color: #4F378B; margin: 10px 0 22px; letter-spacing: -0.2px; }
          ul { list-style: none; padding-left: 0; margin: 0; }
          ul ul { padding-left: 18px; }
          li.l1 > div { font-size: 14px; font-weight: 600; margin-top: 10px; padding: 6px 0; border-bottom: 1px solid #E7E0EC; }
          li.l2 > div { font-size: 12px; font-weight: 400; padding: 3px 0; color: #49454F; }
          span { float: right; }
          a { text-decoration: none; color: inherit; }
        </style>
      </head>
      <body>
        <h1>Inhaltsverzeichnis</h1>
        <ul><xsl:apply-templates select="outline:item/outline:item" mode="l1"/></ul>
      </body>
    </html>
  </xsl:template>
  <xsl:template match="outline:item" mode="l1">
    <li class="l1">
      <div><a href="{@link}"><xsl:value-of select="@title"/></a><span><xsl:value-of select="@page"/></span></div>
      <ul><xsl:comment>.</xsl:comment><xsl:apply-templates select="outline:item" mode="l2"/></ul>
    </li>
  </xsl:template>
  <xsl:template match="outline:item" mode="l2">
    <li class="l2"><div><a href="{@link}"><xsl:value-of select="@title"/></a><span><xsl:value-of select="@page"/></span></div></li>
  </xsl:template>
</xsl:stylesheet>
